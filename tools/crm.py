"""Rovenixa CRM – zápis do dashboardu jedním příkazem (pro Clauda i lidi).

NEJRYCHLEJŠÍ: hromadně jedním voláním (JSON na stdin), klienta lze určit názvem,
náhledem, e-mailem, telefonem nebo ID:

  crm do - <<'EOF'
  [
    {"lead": {"name": "Kosmetika Růže", "email": "ruze@seznam.cz", "phone": "777 111 222",
              "city": "Brno", "web": "http://ruze.cz", "preview": "https://ruze.vercel.app"}},
    {"klient": "ruze.vercel.app", "stage": "odeslano"},
    {"klient": "Studio M", "stage": "pozdeji", "next_date": "2026-12-20", "next_action": "Napsat znovu",
     "add_note": "ozve se po Vánocích"},
    {"log": "web", "pocet": 6},
    {"log": "followup", "pocet": 12},
    {"platba": 6999, "klient_platby": "Studio M", "popis": "Web – záloha", "stav_platby": "ceka"}
  ]
  EOF

Jednotlivě:
  crm lead "Firma" --email x@y.cz --preview https://firma.vercel.app
  crm set "Nehty Andrea" stage=zajem next_date=2026-12-01 next_action="Zavolat" add_note="chce cenu"
  crm log web 5          crm log odeslano 27 --note "nové náhledy"
  crm money 6999 --label "Web Růže" --client 12 --status ceka
  crm find kosmetika     crm list --stage zajem     crm stats

Změna fáze sama zapíše aktivitu (odeslano/odpoved/schuzka/uzavreno) a u „odeslano“ datum.
„Kdo“ se bere z kdo.txt vedle skriptu (na tomhle PC „Jakub“), jinak z --actor / "kdo".
Fáze: studeny, novy, odeslano, zajem, schuzka, pozdeji, nabidka, uzavreny, odmitl
Aktivita: web, odeslano, followup, odpoved, hovor, schuzka, uzavreno
Klíč: claude-klic.txt vedle skriptu (NIKAM NEVKLÁDAT).
"""
import argparse, json, sys, urllib.request, urllib.error, datetime, os, pathlib

try:
    import truststore; truststore.inject_into_ssl()  # Avast podvrhuje certifikáty
except Exception:
    pass

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, 'reconfigure'):
        _s.reconfigure(encoding='utf-8')
if hasattr(sys.stdin, 'reconfigure'):
    sys.stdin.reconfigure(encoding='utf-8')

HERE = pathlib.Path(__file__).resolve().parent
API = os.environ.get('CRM_API', 'https://rovenixa-crm.rovenixa.workers.dev')
KEY = (HERE / 'claude-klic.txt').read_text().strip()
KDO = os.environ.get('CRM_KDO') or ((HERE / 'kdo.txt').read_text(encoding='utf8').strip()
                                     if (HERE / 'kdo.txt').exists() else 'Claude')
STAGES = ['studeny', 'novy', 'odeslano', 'zajem', 'schuzka', 'pozdeji', 'nabidka', 'uzavreny', 'odmitl']
KINDS = ['web', 'odeslano', 'followup', 'odpoved', 'hovor', 'schuzka', 'uzavreno']
STAGE_KIND = {'novy': 'web', 'odeslano': 'odeslano', 'zajem': 'odpoved', 'schuzka': 'schuzka', 'uzavreny': 'uzavreno'}
FIELDS = ['name', 'person', 'phone', 'email', 'city', 'web', 'preview', 'stage', 'price', 'next_date',
          'next_action', 'sent_date', 'note', 'source', 'made_by', 'owner', 'typ']


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json',
        'User-Agent': 'rovenixa-crm-cli'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            sys.exit(f'API {e.code}: {e.read().decode()}')
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            if attempt == 3:
                sys.exit(f'Spojení s API selhalo: {e}')
            import time; time.sleep(2 * (attempt + 1))


def today():
    return datetime.date.today().isoformat()


def show(rows):
    for c in rows:
        nd = f" | {c['next_date']} {c['next_action']}" if c.get('next_date') else ''
        print(f"#{c['id']:<4} {c['stage']:<9} {c['name'][:40]:<40} {c.get('email') or c.get('phone') or ''}{nd}")
    print(f'({len(rows)})')


def host(u):
    return (u or '').lower().replace('https://', '').replace('http://', '').strip().rstrip('/')


def digits9(s):
    return ''.join(ch for ch in (s or '') if ch.isdigit())[-9:]


def find_existing(clients, name, email, preview):
    for c in clients:
        if preview and c.get('preview') and host(c['preview']) == host(preview):
            return c
        if email and c.get('email') and c['email'].lower().strip() == email.lower().strip():
            return c
        if name and c['name'].strip().lower() == name.strip().lower():
            return c
    return None


def resolve(clients, ref):
    """Klient podle ID, náhledu, e-mailu, telefonu nebo (části) názvu."""
    r = str(ref).strip()
    if r.isdigit() and len(r) < 7:
        return next((c for c in clients if c['id'] == int(r)), None)
    low = r.lower()
    tests = [
        lambda c: c.get('preview') and host(c['preview']) == host(low),
        lambda c: '@' in low and low in (c.get('email') or '').lower(),
        lambda c: len(digits9(r)) == 9 and digits9(c.get('phone')) == digits9(r),
        lambda c: c['name'].lower() == low,
    ]
    for t in tests:
        hit = [c for c in clients if t(c)]
        if hit:
            return hit[0]
    hit = [c for c in clients if low in c['name'].lower()]
    if len(hit) == 1:
        return hit[0]
    if len(hit) > 1:
        sys.exit(f'„{ref}“ odpovídá víc klientům: ' + ', '.join(f"#{c['id']} {c['name']}" for c in hit[:6]))
    return None


def change(clients, ref, fields, actor):
    """Upraví klienta; při změně fáze sám zapíše aktivitu a datum odeslání."""
    c = resolve(clients, ref)
    if not c:
        sys.exit(f'Klient „{ref}“ nenalezen')
    b = {k: v for k, v in fields.items() if k in FIELDS and k != 'name' or (k == 'name' and fields.get('rename'))}
    if 'price' in b and str(b['price']).isdigit():
        b['price'] = int(b['price'])
    if 'stage' in b and b['stage'] not in STAGES:
        sys.exit(f'Neznámá fáze {b["stage"]}, použij: {STAGES}')
    if b.get('stage') == 'odeslano' and not c.get('sent_date') and 'sent_date' not in b:
        b['sent_date'] = today()
    if fields.get('add_note'):
        b['note'] = ((c.get('note') or '') + f"\n[{today()}] " + fields['add_note']).strip()
    if not b:
        return c
    r = call('PATCH', f"/api/clients/{c['id']}", b)
    if b.get('stage') and b['stage'] != c['stage'] and STAGE_KIND.get(b['stage']) and not fields.get('bez_logu'):
        call('POST', '/api/activity', {'kind': STAGE_KIND[b['stage']], 'count': 1, 'actor': actor,
                                       'date': today(), 'client_id': c['id'], 'note': c['name']})
    clients[clients.index(c)] = r
    return r


def upsert(clients, d, actor):
    d = {k: v for k, v in d.items() if v not in (None, '')}
    ex = find_existing(clients, d.get('name'), d.get('email'), d.get('preview'))
    if ex:
        return change(clients, ex['id'], d, actor), 'upraveno'
    if not d.get('name'):
        sys.exit('Lead bez názvu: ' + json.dumps(d, ensure_ascii=False))
    d.setdefault('stage', 'novy')
    d.setdefault('made_by', actor)
    if d['stage'] not in STAGES:
        sys.exit(f'Neznámá fáze {d["stage"]}')
    if d['stage'] == 'odeslano':
        d.setdefault('sent_date', today())
    body = {k: v for k, v in d.items() if k in FIELDS}
    if d.get('add_note'):
        body['note'] = (body.get('note', '') + ' ' + d['add_note']).strip()
    r = call('POST', '/api/clients', body)
    clients.insert(0, r)
    if STAGE_KIND.get(r['stage']) and not d.get('bez_logu'):
        call('POST', '/api/activity', {'kind': STAGE_KIND[r['stage']], 'count': 1, 'actor': actor,
                                       'date': today(), 'client_id': r['id'], 'note': r['name']})
    return r, 'přidáno'


def run_batch(ops, actor):
    clients = call('GET', '/api/clients')
    for op in ops:
        a = op.get('kdo', actor)
        if 'lead' in op:
            r, how = upsert(clients, op['lead'], a)
            print(how, f"#{r['id']} {r['name']} ({r['stage']})")
        elif 'klient' in op:
            f = {k: v for k, v in op.items() if k not in ('klient', 'kdo')}
            r = change(clients, op['klient'], f, a)
            print('upraveno', f"#{r['id']} {r['name']} ({r['stage']})")
        elif 'log' in op:
            if op['log'] not in KINDS:
                sys.exit(f"Neznámá aktivita {op['log']}, použij: {KINDS}")
            r = call('POST', '/api/activity', {'kind': op['log'], 'count': int(op.get('pocet', 1)),
                     'actor': a, 'date': op.get('datum', today()), 'note': op.get('pozn', '')})
            print('zapsáno', r['date'], r['actor'], r['kind'], r['count'])
        elif 'platba' in op:
            c = resolve(clients, op['klient_platby']) if op.get('klient_platby') else None
            r = call('POST', '/api/money', {'amount': int(op['platba']), 'label': op.get('popis', ''),
                     'kind': op.get('druh', 'prijem'), 'status': op.get('stav_platby', 'zaplaceno'),
                     'client_id': c['id'] if c else None, 'date': op.get('datum', today())})
            print('platba', r['amount'], r['status'], c['name'] if c else '')
        else:
            print('?? neznámá operace', json.dumps(op, ensure_ascii=False))


def kv(pairs):
    out = {}
    for p in pairs:
        k, _, v = p.partition('=')
        out[k] = v
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    p = sp.add_parser('do', help='hromadně z JSON (soubor, nebo - = stdin)'); p.add_argument('src', nargs='?', default='-')
    p = sp.add_parser('list'); p.add_argument('--stage')
    p = sp.add_parser('find'); p.add_argument('text')
    p = sp.add_parser('lead', help='přidá nebo aktualizuje klienta (podle náhledu/e-mailu/názvu)')
    p.add_argument('name')
    for f in FIELDS[1:]:
        if f != 'price':
            p.add_argument('--' + f.replace('_', '-'))
    p.add_argument('--price', type=int)
    p = sp.add_parser('set', help='upraví klienta: set <ID|název|náhled|e-mail|telefon> klic=hodnota …')
    p.add_argument('ref'); p.add_argument('pairs', nargs='+')
    p = sp.add_parser('log'); p.add_argument('kind', choices=KINDS); p.add_argument('count', type=int, nargs='?', default=1)
    p.add_argument('--actor'); p.add_argument('--date'); p.add_argument('--note', default='')
    p = sp.add_parser('money'); p.add_argument('amount', type=int); p.add_argument('--label', default='')
    p.add_argument('--kind', default='prijem', choices=['prijem', 'vydaj'])
    p.add_argument('--status', default='zaplaceno', choices=['zaplaceno', 'ceka'])
    p.add_argument('--client'); p.add_argument('--date')
    p = sp.add_parser('delete'); p.add_argument('table', choices=['clients', 'money', 'activity']); p.add_argument('id', type=int)
    sp.add_parser('stats')
    a = ap.parse_args()

    if a.cmd == 'do':
        raw = sys.stdin.read() if a.src == '-' else open(a.src, encoding='utf8').read()
        ops = json.loads(raw)
        run_batch(ops if isinstance(ops, list) else [ops], KDO)
    elif a.cmd == 'list':
        show([c for c in call('GET', '/api/clients') if not a.stage or c['stage'] == a.stage])
    elif a.cmd == 'find':
        t = a.text.lower()
        show([c for c in call('GET', '/api/clients') if t in json.dumps(c, ensure_ascii=False).lower()])
    elif a.cmd == 'lead':
        r, how = upsert(call('GET', '/api/clients'), {k: v for k, v in vars(a).items() if k != 'cmd'}, KDO)
        print(how, end=' '); show([r])
    elif a.cmd == 'set':
        show([change(call('GET', '/api/clients'), a.ref, kv(a.pairs), KDO)])
    elif a.cmd == 'log':
        r = call('POST', '/api/activity', {'kind': a.kind, 'count': a.count, 'actor': a.actor or KDO,
                                            'date': a.date or today(), 'note': a.note})
        print('zapsáno', r['date'], r['actor'], r['kind'], r['count'])
    elif a.cmd == 'money':
        c = resolve(call('GET', '/api/clients'), a.client) if a.client else None
        r = call('POST', '/api/money', {'amount': a.amount, 'label': a.label, 'kind': a.kind, 'status': a.status,
                                         'client_id': c['id'] if c else None, 'date': a.date or today()})
        print('zapsáno', r['amount'], r['status'], c['name'] if c else '')
    elif a.cmd == 'delete':
        print(call('DELETE', f'/api/{a.table}/{a.id}'))
    elif a.cmd == 'stats':
        d = call('GET', '/api/all')
        from collections import Counter
        print('Fáze:', dict(Counter(c['stage'] for c in d['clients'])))
        wk = (datetime.date.today() - datetime.timedelta(days=6)).isoformat()
        c = Counter()
        for x in d['activity']:
            if x['date'] >= wk:
                c[(x['actor'], x['kind'])] += x['count']
        print('Posledních 7 dní:', {f'{k[0]}/{k[1]}': v for k, v in c.items()})
        print('Přijato:', sum(m['amount'] for m in d['money'] if m['kind'] == 'prijem' and m['status'] == 'zaplaceno'), 'Kč')
        nx = sorted((c for c in d['clients'] if c.get('next_date') and c['stage'] != 'odmitl'), key=lambda c: c['next_date'])
        if nx:
            print('Na řadě:'); show(nx[:10])


if __name__ == '__main__':
    main()
