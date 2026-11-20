// Rovenixa CRM – odpovědi z Gmailu (Google Apps Script). Běží jednou za hodinu.
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
  if (!replies.length && !bounces.length) return;
  UrlFetchApp.fetch(API + '/api/mail/report', { method: 'post', contentType: 'application/json', headers: h,
    payload: JSON.stringify({ replies, bounces }) });
}

// Jen nová odpověď bez citace původního mailu (Gmail, Seznam, Outlook, CZ i EN).
function clean(body) {
  return body.replace(/\r\n?/g, '\n').replace(/ /g, ' ').split(/\n-- ?\n|\n\s*>|\nOn .* wrote:|\nDne .* napsal|\n\s*-{3,}\s*(?:Původní|Puvodni|Original|Přeposlan|Forwarded)|\n_{5,}|\n\s*(?:Od|From):?\s.*@.*\n(?:\s*\n)?\s*(?:Odesláno|Sent|Komu|To|Datum|Date)\b/i)[0]
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, 600);
}
