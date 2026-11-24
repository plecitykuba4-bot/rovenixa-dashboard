// Rovenixa CRM API – Cloudflare Worker + D1
// Secrets: PASS_JAKUB, PASS_JAN, CLAUDE_KEY, TOKEN_SECRET, SPY_URL, MAIL_KEY (Gmail Apps Script), GEMINI_KEY (hlasový souhrn)

const TABLES = {
  clients: ['name', 'person', 'phone', 'email', 'city', 'web', 'preview', 'stage', 'price',
    'next_date', 'next_action', 'sent_date', 'note', 'source', 'made_by', 'owner', 'typ', 'followups', 'last_followup', 'last_call',
    'reply_new', 'reply_at', 'reply_text', 'reply_link'],
  money: ['date', 'kind', 'amount', 'status', 'client_id', 'label'],
  activity: ['date', 'actor', 'kind', 'count', 'client_id', 'note'],
};
const ALLOWED_ORIGINS = [
  'https://plecitykuba4-bot.github.io',
  'http://localhost:5320',
  'http://127.0.0.1:5320',
];
const TOKEN_DAYS = 60;

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

function safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Holé PCM (16 bit, mono) od Gemini → WAV, aby ho prohlížeč přehrál.
function pcmToWav(pcm, rate) {
  const h = new DataView(new ArrayBuffer(44));
  const s = (o, t) => [...t].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  s(0, 'RIFF'); h.setUint32(4, 36 + pcm.length, true); s(8, 'WAVE'); s(12, 'fmt ');
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  s(36, 'data'); h.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length); out.set(new Uint8Array(h.buffer)); out.set(pcm, 44);
  return out;
}

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

async function makeToken(env, user) {
  const exp = Date.now() + TOKEN_DAYS * 864e5;
  const body = `${user}.${exp}`;
  return `${body}.${await hmac(env.TOKEN_SECRET, body)}`;
}

async function whoIs(env, req) {
  const h = req.headers.get('Authorization') || '';
  const t = h.replace(/^Bearer\s+/i, '');
  if (!t) return null;
  if (env.CLAUDE_KEY && safeEq(t, env.CLAUDE_KEY)) return 'Claude';
  const [user, exp, sig] = t.split('.');
  if (!user || !exp || !sig) return null;
  if (Number(exp) < Date.now()) return null;
  if (!safeEq(sig, await hmac(env.TOKEN_SECRET, `${user}.${exp}`))) return null;
  return user;
}

function cors(req) {
  const o = req.headers.get('Origin');
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (o && ALLOWED_ORIGINS.includes(o)) h['Access-Control-Allow-Origin'] = o;
  return h;
}

const json = (req, data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(req) },
});

function pick(table, body) {
  const out = {};
  for (const k of TABLES[table]) if (k in body) out[k] = body[k] === undefined ? null : body[k];
  return out;
}

async function insert(env, table, body, user) {
  const row = pick(table, body);
  if (table === 'clients' && !row.name) throw new Error('Chybí název klienta');
  if (table === 'money' && !row.date) row.date = new Date().toISOString().slice(0, 10);
  if (table === 'activity') {
    if (!row.date) row.date = new Date().toISOString().slice(0, 10);
    if (!row.actor) row.actor = user;
    if (!row.kind) throw new Error('Chybí druh aktivity');
  }
  const byCol = table === 'clients' ? 'updated_by' : 'created_by';
  row[byCol] = user;
  const cols = Object.keys(row);
  const res = await env.DB.prepare(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) RETURNING *`
  ).bind(...cols.map((c) => row[c])).first();
  return res;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    const p = url.pathname.replace(/\/+$/, '');

    try {
      if (p === '/api/login' && req.method === 'POST') {
        const { name, password } = await req.json();
        const users = { jakub: ['Jakub', env.PASS_JAKUB], jan: ['Jan', env.PASS_JAN] };
        const u = users[norm(name)];
        if (!u || !u[1] || !safeEq(norm(password), norm(u[1]))) {
          await new Promise((r) => setTimeout(r, 600));
          return json(req, { error: 'Špatné jméno nebo heslo' }, 401);
        }
        return json(req, { user: u[0], token: await makeToken(env, u[0]) });
      }

      // Gmail Apps Script: hlásí odpovědi a vrácené maily od firem z CRM (vlastní klíč MAIL_KEY)
      if (p.startsWith('/api/mail/')) {
        const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        if (!env.MAIL_KEY || !safeEq(t, env.MAIL_KEY)) return json(req, { error: 'Nepřihlášen' }, 401);
        const all = (await env.DB.prepare("SELECT id, name, email, stage, note, reply_at, made_by, sent_date FROM clients WHERE email <> ''").all()).results;
        const mails = (c) => c.email.toLowerCase().split(/[,;\s]+/).filter((x) => x.includes('@'));
        if (p === '/api/mail/emails' && req.method === 'GET') {
          return json(req, { emails: [...new Set(all.flatMap(mails))] });
        }
        if (p === '/api/mail/report' && req.method === 'POST') {
          const { replies = [], bounces = [], sent = [] } = await req.json();
          const byMail = new Map();
          all.forEach((c) => mails(c).forEach((m) => byMail.set(m, c)));
          const done = [];
          // Odeslané maily (Gmail → Odeslané): první „Návrh nového webu…“ = odesláno, „Připomenutí…“ = follow-up.
          // Každý mail se počítá jen jednou (tabulka sent_mail), follow-up max 1× za den na firmu.
          for (const s of sent.slice(0, 300)) {
            const mid = String(s.id || '');
            if (!mid) continue;
            const subj = String(s.subject || '');
            const kind = s.follow ? 'followup' : /^\s*(re:|fwd?:)/i.test(subj) ? null : /Připomenutí|Pripomeneni/i.test(subj) ? 'followup' : /Návrh nového webu|Navrh noveho webu/i.test(subj) ? 'navrh' : null;
            if (!kind) continue;
            const seen = await env.DB.prepare('SELECT id FROM sent_mail WHERE id=?').bind(mid).first();
            if (seen) continue;
            const day = String(s.at || new Date().toISOString()).slice(0, 10);
            let hit = null;
            for (const to of (s.to || []).slice(0, 10)) { const c = byMail.get(String(to).toLowerCase()); if (c) { hit = c; break; } }
            if (!hit) { await env.DB.prepare('INSERT INTO sent_mail (id, client_id, kind, at) VALUES (?,?,?,?)').bind(mid, null, 'nezname', day).run(); continue; }
            const actor = hit.made_by || s.who || 'Gmail';
            let what = 'beze změny';
            if (kind === 'navrh' && ['novy', 'studeny'].includes(hit.stage)) {
              await env.DB.prepare("UPDATE clients SET stage='odeslano', sent_date=?, updated_at=datetime('now'), updated_by='Gmail' WHERE id=?").bind(day, hit.id).run();
              await env.DB.prepare('INSERT INTO activity (date, actor, kind, count, client_id, note, created_by) VALUES (?,?,?,?,?,?,?)').bind(day, actor, 'odeslano', 1, hit.id, hit.name, 'Gmail').run();
              hit.stage = 'odeslano'; hit.sent_date = day; what = 'odesláno';
            } else if (kind === 'navrh' && hit.stage === 'odeslano' && !hit.sent_date) {
              await env.DB.prepare("UPDATE clients SET sent_date=?, updated_at=datetime('now'), updated_by='Gmail' WHERE id=?").bind(day, hit.id).run();
              hit.sent_date = day; what = 'doplněno datum';
            } else if (kind === 'followup' && hit.stage === 'odeslano') {
              const row = await env.DB.prepare('SELECT followups, last_followup, sent_date FROM clients WHERE id=?').bind(hit.id).first();
              if (row && row.last_followup !== day && (row.sent_date || '') < day) {
                await env.DB.prepare("UPDATE clients SET followups=?, last_followup=?, updated_at=datetime('now'), updated_by='Gmail' WHERE id=?").bind((row.followups || 0) + 1, day, hit.id).run();
                await env.DB.prepare('INSERT INTO activity (date, actor, kind, count, client_id, note, created_by) VALUES (?,?,?,?,?,?,?)').bind(day, actor, 'followup', 1, hit.id, hit.name, 'Gmail').run();
                what = 'follow-up zapsán';
              }
            }
            await env.DB.prepare('INSERT INTO sent_mail (id, client_id, kind, at) VALUES (?,?,?,?)').bind(mid, hit.id, kind, day).run();
            if (what !== 'beze změny') done.push({ id: hit.id, name: hit.name, kind: what });
          }
          for (const r of replies.slice(0, 200)) {
            const c = byMail.get(String(r.email || '').toLowerCase());
            if (!c || (c.reply_at && c.reply_at >= r.at)) continue;
            await env.DB.prepare("UPDATE clients SET reply_new=1, reply_at=?, reply_text=?, reply_link=?, updated_at=datetime('now'), updated_by='Gmail' WHERE id=?")
              .bind(String(r.at), String(r.text || '').slice(0, 600), String(r.link || ''), c.id).run();
            c.reply_at = r.at; done.push({ id: c.id, name: c.name, kind: 'odpoved' });
          }
          for (const b of bounces.slice(0, 200)) {
            const c = byMail.get(String(b.email || '').toLowerCase());
            if (!c || /Nedoručeno/.test(c.note || '')) continue;
            const day = String(b.at || new Date().toISOString()).slice(0, 10);
            const line = `[${day}] Nedoručeno: Gmail vrátil e-mail na ${b.email}`;
            const only = mails(c).length === 1 && ['novy', 'odeslano'].includes(c.stage);
            await env.DB.prepare(`UPDATE clients SET note=?, ${only ? "stage='odmitl', " : ''}updated_at=datetime('now'), updated_by='Gmail' WHERE id=?`)
              .bind(((c.note || '') + '\n' + line).trim(), c.id).run();
            c.note = line; done.push({ id: c.id, name: c.name, kind: only ? 'nedoruceno' : 'nedoruceno-jedna-adresa' });
          }
          return json(req, { ok: true, done });
        }
        return json(req, { error: 'Nenalezeno' }, 404);
      }

      const user = await whoIs(env, req);
      if (!user) return json(req, { error: 'Nepřihlášen' }, 401);

      if (p === '/api/me') return json(req, { user });

      // Hlasový souhrn: text složí dashboard, tady z něj Gemini udělá řeč (hlas Charon).
      // Vlastní TTS modely, ne ten z reelů (gemini-3.8-flash-tts), ať se nežere jejich denní limit.
      if (p === '/api/tts' && req.method === 'POST') {
        if (!env.GEMINI_KEY) return json(req, { error: 'Hlas není nastavený' }, 503);
        const text = String((await req.json()).text || '').trim().slice(0, 2500);
        if (!text) return json(req, { error: 'Prázdný text' }, 400);
        const voice = 'Charon';
        const hash = b64u(await crypto.subtle.digest('SHA-256', enc.encode(voice + '|' + text)));
        const ck = new Request('https://cache.local/tts/' + hash);
        const audioRes = (buf) => new Response(buf, { headers: { ...cors(req), 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=86400' } });
        const hit = await caches.default.match(ck);
        if (hit) return audioRes(await hit.arrayBuffer());
        const prompt = 'Read this as a short, warm daily briefing in standard Czech (cs-CZ), native Prague accent, '
          + 'natural Czech vowel lengths, calm friendly pace, never Slovak, never a foreign accent. Read only the text:\n\n' + text;
        let last = '';
        for (const model of ['gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts']) {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
            }),
          });
          if (!r.ok) { last = `${model} ${r.status}`; continue; }
          const d = await r.json();
          const part = (d.candidates?.[0]?.content?.parts || []).find((x) => x.inlineData);
          if (!part) { last = `${model} bez zvuku`; continue; }
          let bytes = Uint8Array.from(atob(part.inlineData.data), (ch) => ch.charCodeAt(0));
          if (!/wav/i.test(part.inlineData.mimeType || '')) bytes = pcmToWav(bytes, Number((/rate=(\d+)/.exec(part.inlineData.mimeType || '') || [])[1]) || 24000);
          await caches.default.put(ck, new Response(bytes, { headers: { 'Cache-Control': 'max-age=604800' } }));
          return audioRes(bytes);
        }
        return json(req, { error: 'Hlas teď nejde (' + last + ')' }, 502);
      }

      // Návštěvy náhledů ze „špióna“ (navrhy-stats) – klíč je jen v secretu SPY_URL
      if (p === '/api/visits' && req.method === 'GET') {
        const cache = caches.default;
        const ck = new Request('https://cache.local/visits');
        let res = url.searchParams.get('fresh') ? null : await cache.match(ck);
        if (!res) {
          const r = await fetch(env.SPY_URL, { headers: { 'User-Agent': 'rovenixa-crm' } });
          if (!r.ok) return json(req, { error: 'Špión neodpovídá (' + r.status + ')' }, 502);
          const raw = await r.json();
          const slim = raw.map((v) => ({ site: v.site, t: v.t, trida: v.trida, verdikt: v.verdikt,
            detail: v.detail, city: v.city, ref: String(v.ref || '').replace(/^https?:\/\//, '').split('/')[0],
            mobil: (v.w || 9999) < 800, sc: v.sc || 0, d: v.act || v.d || 0 }));
          res = new Response(JSON.stringify(slim), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=120' } });
          await cache.put(ck, res.clone());
        }
        return json(req, await res.json());
      }

      if (p === '/api/all' && req.method === 'GET') {
        const [c, m, a] = await env.DB.batch([
          env.DB.prepare('SELECT * FROM clients ORDER BY updated_at DESC'),
          env.DB.prepare('SELECT * FROM money ORDER BY date DESC, id DESC'),
          env.DB.prepare('SELECT * FROM activity ORDER BY date DESC, id DESC LIMIT 3000'),
        ]);
        return json(req, { user, clients: c.results, money: m.results, activity: a.results });
      }

      const m = p.match(/^\/api\/(clients|money|activity)(?:\/(\d+))?$/);
      if (!m) return json(req, { error: 'Nenalezeno' }, 404);
      const [, table, id] = m;

      if (req.method === 'GET' && !id) {
        const r = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all();
        return json(req, r.results);
      }
      if (req.method === 'GET' && id) {
        const r = await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first();
        return r ? json(req, r) : json(req, { error: 'Nenalezeno' }, 404);
      }
      if (req.method === 'POST' && !id) {
        const body = await req.json();
        if (Array.isArray(body)) {
          if (body.length > 500) return json(req, { error: 'Max 500 řádků naráz' }, 400);
          const out = [];
          for (const b of body) out.push(await insert(env, table, b, user));
          return json(req, out, 201);
        }
        return json(req, await insert(env, table, body, user), 201);
      }
      if (req.method === 'PATCH' && id) {
        const row = pick(table, await req.json());
        const cols = Object.keys(row);
        if (!cols.length) return json(req, { error: 'Nic ke změně' }, 400);
        const r = await env.DB.prepare(
          `UPDATE ${table} SET ${cols.map((c) => `${c}=?`).join(',')}, updated_at=datetime('now'), updated_by=? WHERE id=? RETURNING *`
        ).bind(...cols.map((c) => row[c]), user, id).first();
        return r ? json(req, r) : json(req, { error: 'Nenalezeno' }, 404);
      }
      if (req.method === 'DELETE' && id) {
        await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
        if (table === 'clients') {
          await env.DB.batch([
            env.DB.prepare('UPDATE money SET client_id=NULL WHERE client_id=?').bind(id),
            env.DB.prepare('UPDATE activity SET client_id=NULL WHERE client_id=?').bind(id),
          ]);
        }
        return json(req, { ok: true });
      }
      return json(req, { error: 'Metoda nepovolena' }, 405);
    } catch (e) {
      return json(req, { error: String(e.message || e) }, 400);
    }
  },
};
