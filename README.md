# Kijkdag Heultje — Landingspagina

Conversiegerichte landingspagina voor de kijkdag van drie vrijstaande RDK-nieuwbouwwoningen in Heultje (Westerlo), op zaterdag **28 november 2026, 10:00 – 14:00**. Organiserende makelaar: **De Groot & Celen**.

Standalone HTML (geen framework), zodat ze aansluit bij de bestaande conventie in deze map (`olen-presale-landing.html` e.d.). Een lichte Node-server (`server.js`) handelt het inschrijvingsformulier af.

---

## Snel starten

```bash
cd heultje-kijkdag
node server.js
# open http://localhost:3000
```

Zonder server kan je `index.html` ook rechtstreeks in de browser openen om het ontwerp te bekijken — maar het inschrijvingsformulier werkt dán niet (dat is bewust: er wordt géén succes gesimuleerd zonder backend).

Alternatief voor hosting: upload de map naar Netlify / Vercel / Cloudflare Pages en wire een serverless function voor `/api/signup`.

---

## Projectstructuur

```
heultje-kijkdag/
├── index.html         Landingspagina (hero → form → footer)
├── bedankt.html       Bedankpagina na succesvolle inschrijving
├── server.js          Node-server + /api/signup endpoint
├── assets/            Afbeeldingen (zie "Benodigde afbeeldingen")
├── data/              Automatisch aangemaakt — leads landen in signups.ndjson
└── README.md
```

---

## Benodigde afbeeldingen

Plaats JPEG/WebP-bestanden in `assets/`. Totale paginagrootte streven: < 1,5 MB — comprimeer renders tot ca. 180 KB per beeld. Formaten:

| Bestand            | Gebruik                                 | Aanbev. afmeting |
| ------------------ | --------------------------------------- | ---------------- |
| `hero-exterior.jpg`| Hero (full-bleed)                       | 2400 × 1600      |
| `og-heultje.jpg`   | Open Graph / social                     | 1200 × 630       |
| `gallery-1.jpg`    | Galerij — straatzicht (wide)            | 2000 × 1125      |
| `gallery-2.jpg`    | Galerij — leefruimte                    | 1600 × 1200      |
| `gallery-3.jpg`    | Galerij — tuin                          | 1600 × 1200      |
| `gallery-4.jpg`    | Galerij — trap (tall)                   | 1200 × 1600      |
| `gallery-5.jpg`    | Galerij — slaapkamer                    | 1600 × 1200      |
| `gallery-6.jpg`    | Galerij — carport                       | 1600 × 1200      |
| `gallery-7.jpg`    | Galerij — omgeving (wide)               | 2000 × 1125      |
| `kijkdag-side.jpg` | Decoratief rechts in "De kijkdag"       | 1600 × 1200      |
| `closing.jpg`      | Afsluitende CTA (full-bleed)            | 2400 × 1600      |

Zolang een beeld ontbreekt, toont de pagina een nette getinte placeholder met het label van het beeld — zo blijft de layout correct.

**Tag per beeld:** in de galerij is "Visualisatie" of "Actuele foto" al in de HTML aangeduid. Pas aan in `index.html` (zoek op `tag render` of `tag`) wanneer je de bronfoto's hebt gezien.

---

## Werking van het inschrijvingsformulier

Front-end (`index.html`):

- client-side validatie van alle verplichte velden
- honeypot-veld (`website`) tegen bots
- deduplicatie per e-mail in `sessionStorage`
- POST naar het endpoint uit `data-endpoint` (standaard: `/api/signup`)
- bij succes → redirect naar `bedankt.html`
- bij fout → inline foutmelding zonder valse "succes"-melding

Back-end (`server.js`):

- JSON-schema validatie (reguliere expressies op e-mail/telefoon)
- payload-grootte limiet (32 KB)
- rate limiting: 5 inzendingen / 60 s per IP
- append-only logging naar `data/signups.ndjson` (één JSON-record per regel)
- optioneel forwarden naar een extern CRM/webhook via `FORWARD_URL`

De bevestigingsmail is nog niet aangesloten (zie onder "Nog te configureren").

---

## Koppelen aan CRM, webhook of e-mailplatform

Open `server.js` → functie `handleLead(record)`:

1. **CRM / webhook (Make, Zapier, HubSpot, Pipedrive, …)** — zet de env-var `FORWARD_URL` naar je endpoint:

   ```bash
   FORWARD_URL="https://hook.eu1.make.com/xxxxxxx" node server.js
   ```

2. **Bevestigingsmail (SMTP of transactionele provider)** — voeg een provider toe. Voorbeeld met `nodemailer`:

   ```bash
   npm init -y && npm i nodemailer
   ```
   en vul de `TODO`-sectie in `handleLead()` aan.

3. **Google Sheets / Airtable** — hang een Make/Zapier-scenario aan de webhook. Het veldenschema is: `voornaam, achternaam, email, telefoon, slot, opmerking, privacy, utm, page, ip, ua, received_at`.

---

## Tracking (Meta Pixel + GA4) — met consent

Tracking is bewust **uitgeschakeld tot er geldige toestemming is**. Onderaan `index.html` staat een HTML-commentblok met de scaffolding voor Meta Pixel en GA4. Werkwijze:

1. Haal het commentblok weg en vul je `PIXEL_ID` + `G-XXXXXXX` in.
2. Zet `window.__consent = true` nadat je consent-management platform (bv. Cookiebot, Didomi, Osano) de analytische/marketing-categorie heeft goedgekeurd.
3. Het **`Lead`-event vuurt alleen op `bedankt.html`** (en slechts één keer per sessie, zie `kijkdag_lead_fired`-vlag).

Op die manier is er dus geen Lead-event bij een mislukte of simulatie-inzending, en wordt dedup afgedwongen.

---

## UTM-parameters

Bezoekers die via Meta Ads binnenkomen behouden hun `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid` en `gclid` — die worden in `sessionStorage` bewaard en meegestuurd met de inschrijving (veld `utm`).

---

## Nog aan te vullen (markeringen in de code)

- [ ] Projectrenders en actuele foto's in `assets/` plaatsen
- [ ] `og-heultje.jpg` voor social preview
- [ ] Exact coördinaat voor de kaart (de huidige iframe wijst naar Heultje als dorpscentrum — `index.html`, sectie `#locatie`, iframe-src). Vervang `marker=51.1132%2C4.8891` met het precieze adres zodra dat bevestigd is.
- [ ] `FORWARD_URL` naar jullie CRM/webhook
- [ ] Transactionele e-mailprovider aansluiten (confirmatiemail)
- [ ] `PIXEL_ID` + `G-XXXXXXX` + CMP wiring
- [ ] Privacy- en cookieverklaring linken naar jullie officiële pagina's (nu generiek `/`)
- [ ] Juridische vastgoedvermeldingen (BIV-nummer, erkenning) toevoegen in de footer indien van toepassing
- [ ] Open Graph afbeelding renderen vanuit het hero-beeld

---

## Online publiceren

**Statisch (snelst):**

- Netlify / Vercel / Cloudflare Pages: sleep de map erin.
- Zet een serverless function op `/api/signup` die hetzelfde JSON-contract afhandelt als `server.js`.

**Als Node-app (eenvoudig):**

- Push naar een Fly.io, Render of Hetzner-droplet; start met `node server.js`.
- Zet `FORWARD_URL` als env-var.

**Als onderdeel van degroot-celen.be:**

- Bouw `index.html` + `bedankt.html` + assets in als sub-pad (bv. `/kijkdag-heultje`).
- Point het formulier via `data-endpoint` naar jullie eigen inschrijvings-endpoint.

---

## Projectdata (verifieerbaar — bronnen De Groot & Celen + RDK)

- 3 vrijstaande woningen (loten 14, 15, 16) · 4 gevels · perceel ca. 350 m²
- 3 slaapkamers · 1 badkamer (inloopdouche, bad, dubbele lavabo)
- Leefruimte ca. 106 m² · open keuken aansluitend op tuin + terras
- Lucht-waterwarmtepomp · vloerverwarming · zonnepanelen · ventilatiesysteem
- E-peil max 10 — bijna-energieneutraal (BEN)
- Carport met aansluitende tuinberging
- Doodlopende zijstraat van de Achterheide, met groen pleintje in de verkaveling
- Richtprijzen: Lot 14 € 385.986 · Lot 15 € 386.711 · Lot 16 € 385.586
- Vergunningen: stedenbouwkundig ja · verkaveling ja · P-score A · G-score A
- Bouwheer: **RDK** (familiebedrijf, actief sinds 1971)
- Makelaar: **De Groot & Celen** · 014 95 37 50 · secretariaat@degroot-celen.be

Niet verifieerbaar bij publicatie en dus niet opgenomen in de teksten: definitieve EPC-waarde, exact huisnummer, bewoonbare oppervlakte per woning. Vul deze aan zodra ze officieel vastliggen.
