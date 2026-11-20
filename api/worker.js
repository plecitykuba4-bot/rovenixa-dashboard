// Rovenixa CRM API – Cloudflare Worker + D1
// Secrets: PASS_JAKUB, PASS_JAN, CLAUDE_KEY, TOKEN_SECRET, SPY_URL

const TABLES = {
  clients: ['name', 'person', 'phone', 'email', 'city', 'web', 'preview', 'stage', 'price',
    'next_date', 'next_action', 'sent_date', 'note', 'source', 'made_by', 'owner', 'typ', 'followups', 'last_followup', 'last_call'],
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

      const user = await whoIs(env, req);
      if (!user) return json(req, { error: 'Nepřihlášen' }, 401);

      if (p === '/api/me') return json(req, { user });

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
            detail: v.detail, city: v.city, mobil: (v.w || 9999) < 800, sc: v.sc || 0, d: v.act || v.d || 0 }));
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
