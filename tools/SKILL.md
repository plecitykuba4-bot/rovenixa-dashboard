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

## Odeslané návrhy: volat, nebo follow-up (počítá se samo)

Aplikace u každé firmy ve fázi `odeslano` sama určí, co dál – podle špióna (návštěvy náhledu z navrhy-stats):
- **Zavolat** = člověk viděl náhled po odeslání a firma se neozvala. Volá Jakub/Jan, ty nevoláš.
- **Follow-up podle termínu**: 1. follow-up = odeslání + 3 dny, 2. follow-up = 5 dní po 1. follow-upu. Termín v sobotu/neděli se posouvá na pondělí. Víc ne. Každý den poslat všem, kdo mají termín dnes nebo po termínu, a zapsat `{"klient": …, "followup": true}`.
- **Šuplíky**: follow-upy, odeslání návrhu i stavba webu patří jen tomu Claudovi, který lead má (`made_by`: Jan = Claude 1, Jakub = Claude 2). Cizí šuplík nesahat. Zavolat je společné pro oba. `crm.py` to hlídá sám: follow-up, `stage` novy/odeslano na cizím leadu skončí hláškou STOP a nic nezapíše (`"cizi": true` jen na výslovný pokyn Kuby). Nové leady (`lead`) se zapíšou do šuplíku podle `kdo.txt` (PC Clauda 1 = `Jan`, PC Clauda 2 = `Jakub`).
- `crm.py fronta` vypíše Zavolat (s % prohlédnuté stránky a časem) a tvůj šuplík: follow-up dnes, příští termíny, odeslat návrh, udělat web. `--vse` = oba šuplíky.
- Po 2 follow-upech bez reakce = „Bez reakce“.

`crm.py fronta` vypíše oba seznamy (s telefony a e-maily). Odeslaný follow-up zapiš
`{"klient": "...", "followup": true}` – zvýší počet, uloží datum a zapíše statistiku. Ruční úkol „poslat follow-up“
do `next_date` nedávej, to aplikace hlídá sama.

Odpověď firmy: `{"klient": "...", "stage": "zajem|schuzka|pozdeji|odmitl", "next_date": "...", "next_action": "...", "add_note": "Odpověď: co napsal"}`.
Do `next_date` + `next_action` patří jen domluvené věci (schůzka, slíbený hovor, „ozvěte se v únoru“) – ukazují se v „Domluvené termíny“.

## Kontrola

`crm.py fronta`, `crm.py find text`, `crm.py list --stage zajem`, `crm.py stats` (fáze, posledních 7 dní, domluvené termíny).
Když `klient` vrátí „odpovídá víc klientům“, použij přesnější název nebo ID z výpisu.

## Pravidla

- Zapisuj hned po události, ne až na konci dne – oba to vidí živě.
- Zapisuj jen to, co se opravdu stalo (odeslané maily, ne koncepty).
- Google tabulku „weby Outreach“ už neplnit, evidence je jen tady.
