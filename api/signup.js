// Vercel serverless function for POST /api/signup
// Validates the form submission, forwards it to a webhook (CRM / Make / Zapier),
// and optionally sends a confirmation e-mail via Resend.
//
// Required env vars (set in the Vercel project → Settings → Environment Variables):
//   FORWARD_URL   — https webhook URL to forward every lead to (optional but recommended)
//   RESEND_API_KEY — Resend API key for the confirmation e-mail (optional)
//   RESEND_FROM    — "Naam <noreply@degroot-celen.be>" (optional, needs Resend domain verified)
//   NOTIFY_EMAIL   — kantoor-mailadres dat elke inschrijving als notificatie ontvangt (optional)

const RX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RX_PHONE = /^[0-9+\s().\-]{8,20}$/;

const bucket = new Map(); // naive per-instance limiter — on Vercel reset per cold start.
function rateLimited(ip) {
  const now = Date.now(), w = 60_000, max = 5;
  const list = (bucket.get(ip) || []).filter(t => now - t < w);
  list.push(now);
  bucket.set(ip, list);
  return list.length > max;
}

function s(v, max = 200) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }

function validate(body) {
  const errors = {};
  const voornaam  = s(body.voornaam, 80);
  const achternaam = s(body.achternaam, 80);
  const email     = s(body.email, 160).toLowerCase();
  const telefoon  = s(body.telefoon, 30);
  const slot      = s(body.slot, 10);
  const opmerking = s(body.opmerking, 400);
  const privacy   = body.privacy === true || body.privacy === 'on' || body.privacy === 'true';
  const honeypot  = s(body.website, 100);

  if (voornaam.length < 2) errors.voornaam = 'required';
  if (achternaam.length < 2) errors.achternaam = 'required';
  if (!RX_EMAIL.test(email)) errors.email = 'invalid';
  if (!RX_PHONE.test(telefoon)) errors.telefoon = 'invalid';
  if (!privacy) errors.privacy = 'required';
  if (slot && !['10-11','11-12','12-13','13-14'].includes(slot)) errors.slot = 'invalid';
  if (honeypot) errors.spam = 'detected';

  return { errors, clean: { voornaam, achternaam, email, telefoon, slot, opmerking, privacy } };
}

async function forwardWebhook(record) {
  const url = process.env.FORWARD_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  } catch (e) {
    console.error('[forward] failed:', e.message);
  }
}

async function sendConfirmation(record) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) return;

  const to = [record.email];
  if (process.env.NOTIFY_EMAIL) to.push(process.env.NOTIFY_EMAIL);

  const subject = 'Je inschrijving voor de kijkdag Heultje is bevestigd';
  const html = `
    <div style="font-family: 'Inter', system-ui, sans-serif; color:#1d1d1b; line-height:1.55; max-width:560px;">
      <h1 style="font-size:22px; margin:0 0 12px;">Dag ${record.voornaam},</h1>
      <p>Bedankt voor je inschrijving voor de kijkdag van ons nieuwbouwproject in Heultje.</p>
      <table style="border-collapse:collapse; margin:16px 0 20px;">
        <tr><td style="padding:4px 16px 4px 0; color:#7a7772;">Datum</td><td><strong>Zaterdag 28 november 2026</strong></td></tr>
        <tr><td style="padding:4px 16px 4px 0; color:#7a7772;">Uren</td><td>10:00 – 14:00 (doorlopend)</td></tr>
        <tr><td style="padding:4px 16px 4px 0; color:#7a7772;">Locatie</td><td>Dokter Jozef Draulansstraat, 2260 Westerlo (Heultje)</td></tr>
        ${record.slot ? `<tr><td style="padding:4px 16px 4px 0; color:#7a7772;">Voorkeur</td><td>${record.slot.replace('-',':00 – ')}:00</td></tr>` : ''}
      </table>
      <p>Je mag langskomen wanneer het jou past binnen die uren. Vragen? Bel ons op <a href="tel:+3214953750" style="color:#df6927;">014 95 37 50</a> of antwoord gewoon op deze mail.</p>
      <p style="color:#7a7772; font-size:13px; margin-top:28px;">De Groot &amp; Celen · Project door RDK</p>
    </div>`;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, reply_to: 'secretariaat@degroot-celen.be' }),
    });
    if (!resp.ok) console.error('[resend] status:', resp.status, await resp.text());
  } catch (e) {
    console.error('[resend] failed:', e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ ok: false, error: 'rate_limited' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'bad_json' });

  const { errors, clean } = validate(body);
  if (Object.keys(errors).length) {
    if (errors.spam) return res.status(200).json({ ok: true, dedup: true });
    return res.status(422).json({ ok: false, errors });
  }

  const record = {
    ...clean,
    utm: body.utm || {},
    page: s(body.page, 200),
    ip, ua: s(req.headers['user-agent'], 240),
    received_at: new Date().toISOString(),
  };

  // Fire-and-forget both — but await so Vercel keeps the function alive.
  await Promise.allSettled([forwardWebhook(record), sendConfirmation(record)]);

  return res.status(200).json({ ok: true });
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
