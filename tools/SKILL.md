---
name: rovenixa-crm
description: Zápis do dashboardu studia Rovenixa (studené leady, hotové weby, odeslané návrhy, odpovědi, schůzky, nabídky, platby). Použij VŽDY, když najdeš novou firmu pro outreach, dokončíš náhled webu, odejde e-mail s náhledem nebo follow-up, firma odpoví, domluví se schůzka, pošle se nabídka, klient zaplatí – a když Kuba nebo Jan řekne „zapiš do dashboardu“, „dej to do CRM“, „kolik jsme toho udělali“, „komu máme napsat“. Nahrazuje Excel i Google tabulku „weby Outreach“.
---

# Rovenixa CRM

Dashboard: https://plecitykuba4-bot.github.io/rovenixa-dashboard/ (Jakub a Jan ho čtou, ty do něj píšeš).
Nástroj: `~/.claude/skills/rovenixa-crm/crm.py`, vedle něj `claude-klic.txt` (tajný klíč, nikam nevkládat ani necommitovat)
a `kdo.txt` = čí je tenhle počítač (`Jakub` nebo `Jan`) – pod tím jménem se zapisuje práce.
Zápis je okamžitý, nic se nepotvrzuje.

## Jak psát: jedno volání na celou dávku

Všechno, co se stalo, pošli najednou jako JSON na stdin. Klienta určíš názvem, adresou
náhledu, e-mailem, telefonem nebo ID – stačí cokoli z toho.

```bash
python -X utf8 ~/.claude/skills/rovenixa-crm/crm.py do - <<'EOF'
[
  {"lead": {"name": "Kosmetika Růže", "stage": "studeny", "person": "Jana Nová", "email": "ruze@seznam.cz",
            "phone": "777 111 222", "city": "Brno", "web": "http://ruze.cz", "source": "Firmy.cz",
            "note": "web z roku 2010, nefunguje na mobilu"}},
  {"klient": "Kosmetika Růže", "stage": "novy", "preview": "https://ruze.vercel.app"},
  {"klient": "ruze.vercel.app", "stage": "odeslano"},
  {"klient": "Studio M", "stage": "zajem", "next_date": "2026-11-25", "next_action": "Zavolat", "add_note": "chce cenu"},
  {"log": "followup", "pocet": 12},
  {"platba": 6999, "klient_platby": "Studio M", "popis": "Web – záloha", "stav_platby": "ceka"}
]
EOF
```

- `lead` = přidá firmu, nebo když už existuje (stejný náhled/e-mail/název), doplní. Bez `stage` je `novy`.
- `klient` + pole = úprava. **Změna fáze sama zapíše statistiku**: `novy` = hotový web, `odeslano` = odeslaný návrh
  (+ datum odeslání), `zajem` = odpověď, `schuzka`, `uzavreny`. Totéž už znovu nelogovat přes `log`.
- `add_note` připíše k poznámce s datem; `note` ji celou přepíše.
- `log` = práce bez konkrétní firmy: `followup`, `hovor` (případně `web`, když web není v evidenci). Volitelně `"datum"`, `"pozn"`.
- `platba`: `stav_platby` `zaplaceno` | `ceka`, `druh` `prijem` | `vydaj`, `datum`.
- `typ` zakázky: `web`, `aplikace`, `eshop`, `jine`. `price` = cena v Kč (standard náhledu 6999).

## Fáze

| stage | v dashboardu | kdy |
|---|---|---|
| `studeny` | Studený lead | firma vybraná, web ještě není |
| `novy` | Hotový web | náhled je nasazený |
| `odeslano` | Návrh odeslán | odešel e-mail s náhledem |
| `zajem` | Projevil zájem | odpověděl kladně, chce cenu/hovor |
| `schuzka` | Domluvená schůzka | termín dát do `next_date` |
| `pozdeji` | Napsat později | vždy s `next_date` + `next_action` |
| `nabidka` | Návrh poslán – čeká na platbu | klient má nabídku, čekáme na peníze |
| `uzavreny` | Uzavřený klient | prodáno: `price` + `platba` s datem |
| `odmitl` | Odmítl / nevyšlo | odmítnutí, nedoručený e-mail (důvod do `add_note`) |

`next_date` + `next_action` se ukazuje v „Na řadě“ – tam patří každý follow-up, hovor a připomenutí.

## Kontrola

`crm.py find text`, `crm.py list --stage zajem`, `crm.py stats` (fáze, posledních 7 dní, kdo je na řadě).
Když `klient` vrátí „odpovídá víc klientům“, použij přesnější název nebo ID z výpisu.

## Pravidla

- Zapisuj hned po události, ne až na konci dne – oba to vidí živě.
- Zapisuj jen to, co se opravdu stalo (odeslané maily, ne koncepty).
- Google tabulku „weby Outreach“ už neplnit, evidence je jen tady.
