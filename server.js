// Minimal Node.js server for the Kijkdag Heultje landing page.
// Serves the static site AND handles POST /api/signup with server-side
// validation, honeypot, basic rate limiting and append-only file logging.
//
// Run:   node server.js
// Env:   PORT=3000 FORWARD_URL=https://your-crm.example/webhook SMTP_URL=...
//
// Replace the handleLead() hook with your own CRM / webhook / SMTP integration.

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'signups.ndjson');
const FORWARD_URL = process.env.FORWARD_URL || '';

fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

// --- naive in-memory rate limiter: 5 reqs/60s per IP ---
const bucket = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const w = 60_000, max = 5;
  const list = (bucket.get(ip) || []).filter(t => now - t < w);
  list.push(now);
  bucket.set(ip, list);
  return list.length > max;
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res) {
  let pathname = decodeURIComponent(url.parse(req.url).pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// --- validation helpers ---
const RX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RX_PHONE = /^[0-9+\s().\-]{8,20}$/;
function s(v, max = 200) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function validate(body) {
  const errors = {};
  const voornaam = s(body.voornaam, 80);
  const achternaam = s(body.achternaam, 80);
  const email = s(body.email, 160).toLowerCase();
  const telefoon = s(body.telefoon, 30);
  const slot = s(body.slot, 10);
  const opmerking = s(body.opmerking, 400);
  const privacy = body.privacy === true || body.privacy === 'on' || body.privacy === 'true';
  const honeypot = s(body.website, 100);

  if (voornaam.length < 2) errors.voornaam = 'required';
  if (achternaam.length < 2) errors.achternaam = 'required';
  if (!RX_EMAIL.test(email)) errors.email = 'invalid';
  if (!RX_PHONE.test(telefoon)) errors.telefoon = 'invalid';
  if (!privacy) errors.privacy = 'required';
  if (slot && !['10-11','11-12','12-13','13-14'].includes(slot)) errors.slot = 'invalid';
  if (honeypot) errors.spam = 'detected';

  return { errors, clean: { voornaam, achternaam, email, telefoon, slot, opmerking, privacy } };
}

async function handleLead(record) {
  // 1) Append-only log on disk — reliable fallback even if the webhook fails.
  fs.appendFileSync(DATA_FILE, JSON.stringify(record) + '\n');

  // 2) Forward to a CRM / webhook (e.g. HubSpot, Make, Zapier) if configured.
  if (FORWARD_URL) {
    try {
      await fetch(FORWARD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      });
    } catch (e) {
      console.error('[forward] failed:', e.message);
      // Don't fail the user's submission; it's safely stored locally.
    }
  }

  // 3) TODO: send a confirmation email via your SMTP / transactional provider.
  //    Add nodemailer or an API call here. Example skeleton:
  //
  //    await mailer.send({
  //      to: record.email,
  //      from: 'secretariaat@degroot-celen.be',
  //      subject: 'Je inschrijving voor de kijkdag Heultje is bevestigd',
  //      text: '...',
  //    });
}

function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let buf = ''; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { req.destroy(); reject(new Error('Payload too large')); return; }
      buf += c;
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'POST' && req.url === '/api/signup') {
    const ip = clientIp(req);
    if (rateLimited(ip)) return sendJSON(res, 429, { ok: false, error: 'rate_limited' });

    let body;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw || '{}');
    } catch (e) {
      return sendJSON(res, 400, { ok: false, error: 'bad_json' });
    }

    const { errors, clean } = validate(body);
    if (Object.keys(errors).length) {
      // Honeypot → pretend success to not help spammers (but don't persist).
      if (errors.spam) return sendJSON(res, 200, { ok: true, dedup: true });
      return sendJSON(res, 422, { ok: false, errors });
    }

    const record = {
      ...clean,
      utm: body.utm || {},
      page: s(body.page, 200),
      ip, ua: s(req.headers['user-agent'], 240),
      received_at: new Date().toISOString(),
    };

    try {
      await handleLead(record);
    } catch (e) {
      console.error('[lead] failed:', e);
      return sendJSON(res, 500, { ok: false, error: 'server_error' });
    }
    return sendJSON(res, 200, { ok: true });
  }

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
  res.writeHead(405); res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`Kijkdag Heultje → http://localhost:${PORT}`);
  if (!FORWARD_URL) console.log('[info] FORWARD_URL not set — leads will be stored only in data/signups.ndjson');
});
