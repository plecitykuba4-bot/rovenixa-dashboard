// Rovenixa CRM – odpovědi, vrácené a ODESLANÉ maily z Gmailu (Google Apps Script). Běží jednou za hodinu.
// Od 24. 11. 2026 hlásí i odeslané návrhy a follow-upy, dashboard je sám přepíše na „odesláno“ / zapíše follow-up.
// Aktualizace: otevřít stávající projekt na script.google.com, přepsat kód tímto, ponechat svůj KEY, uložit a spustit funkci check.
// Instalace: script.google.com → Nový projekt → vložit → spustit funkci setup → Povolit.
const API = 'https://rovenixa-crm.rovenixa.workers.dev';
const KEY = 'SEM_VLOZ_MAIL_KEY';

function setup() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('check').timeBased().everyHours(1).create();
  check();
}

function check() {
  const h = { Authorization: 'Bearer ' + KEY };
  const emails = new Set(JSON.parse(UrlFetchApp.fetch(API + '/api/mail/emails', { headers: h }).getContentText()).emails);
  const me = Session.getActiveUser().getEmail();
  const replies = [], bounces = [];
  GmailApp.search('in:inbox newer_than:2d', 0, 200).forEach(t => t.getMessages().forEach(m => {
    const from = (m.getFrom().match(/[\w.+-]+@[\w.-]+/) || [''])[0].toLowerCase();
    const link = 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(me) + '#all/' + t.getId();
    if (emails.has(from)) {
      replies.push({ email: from, at: m.getDate().toISOString(), text: clean(m.getPlainBody()), link });
    } else if (/mailer-daemon|postmaster/i.test(from)) {
      (m.getPlainBody().match(/[\w.+-]+@[\w.-]+/g) || []).map(x => x.toLowerCase())
        .filter(x => emails.has(x)).forEach(x => bounces.push({ email: x, at: m.getDate().toISOString() }));
    }
  }));
  // Odeslané maily: „Návrh nového webu…“ → v CRM odesláno, „Připomenutí…“ (nebo další mail ve vlákně, kde zatím nikdo neodpověděl) → follow-up.
  const sent = [];
  GmailApp.search('in:sent newer_than:3d', 0, 200).forEach(t => {
    const msgs = t.getMessages();
    msgs.forEach((m, i) => {
      if (!m.getFrom().toLowerCase().includes(me.toLowerCase())) return;
      const to = ((m.getTo() + ',' + m.getCc()).match(/[\w.+-]+@[\w.-]+/g) || []).map(x => x.toLowerCase());
      if (!to.some(x => emails.has(x))) return;
      const onlyMine = msgs.slice(0, i).every(p => p.getFrom().toLowerCase().includes(me.toLowerCase()));
      sent.push({ id: m.getId(), to, at: m.getDate().toISOString(), subject: m.getSubject(), follow: i > 0 && onlyMine });
    });
  });
  if (!replies.length && !bounces.length && !sent.length) return;
  UrlFetchApp.fetch(API + '/api/mail/report', { method: 'post', contentType: 'application/json', headers: h,
    payload: JSON.stringify({ replies, bounces, sent }) });
}

// Jen nová odpověď bez citace původního mailu (Gmail, Seznam, Outlook, CZ i EN).
function clean(body) {
  return body.replace(/\r\n?/g, '\n').replace(/ /g, ' ').split(/\n-- ?\n|\n\s*>|\nOn .* wrote:|\nDne .* napsal|\n\s*-{3,}\s*(?:Původní|Puvodni|Original|Přeposlan|Forwarded)|\n_{5,}|\n\s*(?:Od|From):?\s.*@.*\n(?:\s*\n)?\s*(?:Odesláno|Sent|Komu|To|Datum|Date)\b/i)[0]
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, 600);
}
