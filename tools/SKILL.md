---
name: rovenixa-crm
description: Zápis do dashboardu studia Rovenixa (klienti, leady, odeslané návrhy, odpovědi, platby, kolik webů kdo udělal). Použij VŽDY, když vznikne nový náhled webu, odejde e-mail s náhledem nebo follow-up, firma odpoví, domluví se schůzka, klient zaplatí, na konci pracovního bloku na weby, nebo když Kuba řekne „zapiš do dashboardu“, „dej to do CRM“, „kolik jsme toho udělali“, „komu máme napsat“. Nahrazuje Excel a Google tabulku.
---

# Rovenixa CRM

Dashboard: https://plecitykuba4-bot.github.io/rovenixa-dashboard/ (Jakub a Jan ho čtou, ty do něj píšeš).
Nástroj: `C:/Users/doma/Documents/CLAUDE/nastroje/rovenixa-crm/crm.py` (wrapper `crm.cmd` vedle).
„Kdo“ = obsah `kdo.txt` vedle skriptu (tady „Claude 2“). Nic se nepotvrzuje, zápis je okamžitý.

## Jak psát: jedno volání na celou dávku

Všechno, co se během práce stalo, pošli najednou jako JSON na stdin. Klienta určíš názvem,
adresou náhledu, e-mailem, telefonem nebo ID – stačí cokoli z toho.

```bash
python -X utf8 C:/Users/doma/Documents/CLAUDE/nastroje/rovenixa-crm/crm.py do - <<'EOF'
[
  {"lead": {"name": "Kosmetika Růže", "person": "Jana Nová", "email": "ruze@seznam.cz",
            "phone": "777 111 222", "city": "Brno", "web": "http://ruze.cz",
            "preview": "https://ruze.vercel.app", "source": "Firmy.cz", "note": "web z roku 2010"}},
  {"klient": "ruze.vercel.app", "stage": "odeslano"},
  {"klient": "Studio M", "stage": "zajem", "next_date": "2026-11-25", "next_action": "Zavolat", "add_note": "chce cenu"},
  {"log": "web", "pocet": 6},
  {"log": "followup", "pocet": 12},
  {"platba": 6999, "klient_platby": "Studio M", "popis": "Web – záloha", "stav_platby": "ceka"}
]
EOF
```

- `lead` = přidá, nebo když už existuje (stejný náhled/e-mail/název), doplní. Nová firma je `novy` (web hotový), `made_by` = kdo.
- `klient` + pole = úprava. Změna `stage` sama zapíše aktivitu (odeslano → odeslaný návrh, zajem → odpověď, schuzka, uzavreny) a u `odeslano` datum odeslání. Nelogovat to pak znovu přes `log`.
- `add_note` připíše k poznámce s datem; `note` ji celou přepíše.
- `log` = počty práce, které nejsou vázané na klienta: `web` (hotové náhledy), `followup`, `hovor`. Volitelně `"datum"`, `"pozn"`, `"kdo"`.
- `platba`: `stav_platby` `zaplaceno` | `ceka`, `druh` `prijem` | `vydaj`.

Typ zakázky `typ`: `web`, `aplikace`, `eshop`, `jine`. Prodaná zakázka = `stage uzavreny` + `price` + `platba` s datem prodeje (`datum`).

Fáze: `novy` web hotový · `odeslano` návrh odeslán · `zajem` projevil zájem · `schuzka` domluvená schůzka ·
`pozdeji` napsat později (vždy s `next_date` + `next_action`) · `nabidka` návrh/nabídka poslána klientovi, čeká se na platbu · `uzavreny` uzavřený klient · `odmitl` odmítl / nedoručeno.

## Kdy co

| Událost | Zápis |
|---|---|
| Hotový náhled webu | `lead` s náhledem a kontakty + na konci bloku `log web N` |
| Odeslaný e-mail s náhledem | `klient … stage odeslano` (aktivita se zapíše sama) |
| Follow-upy | `log followup N` |
| Odpověď „ozvěte se za měsíc“ | `stage pozdeji`, `next_date`, `next_action`, `add_note` s citací smyslu |
| Odpověď se zájmem / chce zavolat | `stage zajem` nebo `schuzka` + `next_date` |
| Odmítnutí, vrácený mail | `stage odmitl`, `add_note` důvod |
| Klient zaplatil / má zaplatit | `platba` |

## Kontrola

`crm.py find text`, `crm.py list --stage zajem`, `crm.py stats` (fáze, posledních 7 dní, kdo je na řadě).
Když `klient` odpoví „odpovídá víc klientům“, použij přesnější název nebo ID z výpisu.

## Pravidla

- Zapisuj hned po události, ne až na konci dne – Kuba a Jan to vidí živě.
- Neodhadovat: zapisuj jen to, co se opravdu stalo (odeslané maily ověřené, ne koncepty).
- Klíč `claude-klic.txt` nikam nevkládat ani necommitovat.
- Jiné PC (Claude 1): zkopírovat složku `nastroje/rovenixa-crm` a do `kdo.txt` napsat `Claude 1`.
