'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/fieldcrm';
const REPORT_PRICE_CENTS = parseInt(process.env.REPORT_PRICE_CENTS || '4900', 10);
function baseUrl(req) { return (process.env.BASE_URL || (req.protocol + '://' + req.get('host'))).replace(/\/$/, ''); }

// Railway internal hostnames don't use SSL; external proxies and most hosted PG do
const needsSSL = /rlwy\.net|railway\.app|amazonaws|neon\.tech|supabase/.test(DATABASE_URL)
  && !DATABASE_URL.includes('.railway.internal');
const pool = new Pool({ connectionString: DATABASE_URL, ssl: needsSSL ? { rejectUnauthorized: false } : false });

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '30mb' }));
app.use(cookieParser());

/* ---------- auth (single shared password -> signed cookie) ---------- */
function tok() { return crypto.createHmac('sha256', SESSION_SECRET).update('fieldcrm-v1').digest('hex'); }
function authed(req) { return req.cookies && req.cookies.fcrm === tok(); }
function requireAuth(req, res, next) { if (authed(req)) return next(); res.status(401).json({ error: 'unauthorized' }); }

app.post('/api/login', (req, res) => {
  const pw = (req.body && req.body.password) || '';
  if (pw !== APP_PASSWORD) return res.status(401).json({ error: 'Wrong password' });
  res.cookie('fcrm', tok(), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 180 * 24 * 3600 * 1000 });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.clearCookie('fcrm'); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ authed: authed(req) }));

/* ---------- schema ---------- */
async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS markets(
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    center_lat DOUBLE PRECISION NOT NULL,
    center_lng DOUBLE PRECISION NOT NULL,
    zoom INTEGER NOT NULL DEFAULT 11,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS shops(
    id SERIAL PRIMARY KEY,
    market_slug TEXT NOT NULL REFERENCES markets(slug),
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    zip TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    web TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'repair',
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`ALTER TABLE shops
    ADD COLUMN IF NOT EXISTS owner_name TEXT, ADD COLUMN IF NOT EXISTS owner_phone TEXT, ADD COLUMN IF NOT EXISTS owner_email TEXT,
    ADD COLUMN IF NOT EXISTS manager_name TEXT, ADD COLUMN IF NOT EXISTS manager_phone TEXT, ADD COLUMN IF NOT EXISTS manager_email TEXT,
    ADD COLUMN IF NOT EXISTS alliance_status TEXT,
    ADD COLUMN IF NOT EXISTS latest_grade TEXT, ADD COLUMN IF NOT EXISTS latest_score INTEGER,
    ADD COLUMN IF NOT EXISTS last_audit_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS last_report JSONB,
    ADD COLUMN IF NOT EXISTS voice_ai TEXT, ADD COLUMN IF NOT EXISTS voice_ai_provider TEXT, ADD COLUMN IF NOT EXISTS voice_ai_monthly TEXT,
    ADD COLUMN IF NOT EXISTS voice_ai_permin TEXT, ADD COLUMN IF NOT EXISTS voice_ai_setup TEXT,
    ADD COLUMN IF NOT EXISTS cc_processing TEXT, ADD COLUMN IF NOT EXISTS cc_company TEXT, ADD COLUMN IF NOT EXISTS cc_rate TEXT,
    ADD COLUMN IF NOT EXISTS industry TEXT`);
  await pool.query(`CREATE TABLE IF NOT EXISTS audits(
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    report JSONB NOT NULL, score INTEGER, grade TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audits_shop ON audits (shop_id, created_at DESC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS shared_reports(
    token TEXT PRIMARY KEY, name TEXT, report JSONB NOT NULL, summary JSONB,
    paid BOOLEAN DEFAULT false, stripe_session TEXT, created_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS visits(
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    when_ts TEXT NOT NULL,
    materials BOOLEAN NOT NULL DEFAULT false,
    met BOOLEAN NOT NULL DEFAULT false,
    sale BOOLEAN NOT NULL DEFAULT false,
    follow_up TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS positions(
    device TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT 'Rep',
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS documents(
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    share_token TEXT UNIQUE NOT NULL,
    data BYTEA NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`INSERT INTO markets(slug,name,center_lat,center_lng,zoom)
    VALUES('columbus','Columbus, OH',39.9829,-82.9855,11) ON CONFLICT (slug) DO NOTHING`);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM shops');
  if (rows[0].n === 0) {
    const seedPath = path.join(__dirname, 'seed.json');
    if (fs.existsSync(seedPath)) {
      const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
      for (const s of seed) await insertShop('columbus', s);
      console.log('Seeded ' + seed.length + ' Columbus shops');
    }
  }
}

/* Fire-and-forget office notification. Point NOTIFY_WEBHOOK_URL at a
   GoHighLevel inbound webhook (or Zapier/Make) to sync field data. */
function notify(event, payload) {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, at: new Date().toISOString(), ...payload }),
  }).catch(e => console.error('notify failed:', e.message));
}

const SHOP_COLS = ['name', 'address', 'zip', 'phone', 'email', 'web', 'contact', 'category', 'lat', 'lng', 'notes',
  'owner_name', 'owner_phone', 'owner_email', 'manager_name', 'manager_phone', 'manager_email', 'alliance_status',
  'voice_ai', 'voice_ai_provider', 'voice_ai_monthly', 'voice_ai_permin', 'voice_ai_setup', 'cc_processing', 'cc_company', 'cc_rate', 'industry'];
function shopVals(b) {
  return [b.name || '', b.address || '', b.zip || '', b.phone || '', b.email || '', b.web || '',
    b.contact || '', b.category || 'repair',
    isFinite(+b.lat) ? +b.lat : null, isFinite(+b.lng) ? +b.lng : null, b.notes || '',
    b.owner_name || '', b.owner_phone || '', b.owner_email || '',
    b.manager_name || '', b.manager_phone || '', b.manager_email || '', b.alliance_status || '',
    b.voice_ai || '', b.voice_ai_provider || '', b.voice_ai_monthly || '', b.voice_ai_permin || '', b.voice_ai_setup || '',
    b.cc_processing || '', b.cc_company || '', b.cc_rate || '', b.industry || ''];
}
async function insertShop(market, b) {
  const q = `INSERT INTO shops(market_slug,${SHOP_COLS.join(',')})
    VALUES($1,${SHOP_COLS.map((_, i) => '$' + (i + 2)).join(',')}) RETURNING *`;
  return (await pool.query(q, [market, ...shopVals(b)])).rows[0];
}
function visitOut(v) {
  return { id: v.id, shop_id: v.shop_id, when: v.when_ts, materials: v.materials, met: v.met, sale: v.sale, follow_up: v.follow_up, notes: v.notes };
}

/* ---------- markets ---------- */
app.get('/api/markets', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT m.*, COUNT(s.id)::int AS shop_count
      FROM markets m LEFT JOIN shops s ON s.market_slug=m.slug
      GROUP BY m.slug ORDER BY m.name`);
    res.json(rows);
  } catch (e) { next(e); }
});
app.post('/api/markets', requireAuth, async (req, res, next) => {
  try {
    const { slug, name, center_lat, center_lng, zoom } = req.body;
    if (!slug || !name || !isFinite(+center_lat) || !isFinite(+center_lng))
      return res.status(400).json({ error: 'slug, name, center_lat, center_lng required' });
    const { rows } = await pool.query(
      `INSERT INTO markets(slug,name,center_lat,center_lng,zoom) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, center_lat=EXCLUDED.center_lat, center_lng=EXCLUDED.center_lng, zoom=EXCLUDED.zoom
       RETURNING *`,
      [slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'), name, +center_lat, +center_lng, +zoom || 11]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* ---------- shops ---------- */
app.get('/api/shops', requireAuth, async (req, res, next) => {
  try {
    const market = req.query.market || 'columbus';
    const shops = (await pool.query('SELECT * FROM shops WHERE market_slug=$1 ORDER BY name', [market])).rows;
    const visits = (await pool.query(
      `SELECT v.* FROM visits v JOIN shops s ON s.id=v.shop_id WHERE s.market_slug=$1 ORDER BY v.when_ts`, [market])).rows;
    const byShop = {};
    visits.forEach(v => { (byShop[v.shop_id] = byShop[v.shop_id] || []).push(visitOut(v)); });
    res.json(shops.map(s => ({ ...s, visits: byShop[s.id] || [] })));
  } catch (e) { next(e); }
});
app.post('/api/shops', requireAuth, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.name) return res.status(400).json({ error: 'name required' });
    const shop = await insertShop(b.market || 'columbus', b);
    notify('shop.created', { shop });
    res.json({ ...shop, visits: [] });
  } catch (e) { next(e); }
});
app.put('/api/shops/:id', requireAuth, async (req, res, next) => {
  try {
    const sets = SHOP_COLS.map((c, i) => c + '=$' + (i + 2)).join(',');
    const { rows } = await pool.query(
      `UPDATE shops SET ${sets}, updated_at=now() WHERE id=$1 RETURNING *`,
      [+req.params.id, ...shopVals(req.body)]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    notify('shop.updated', { shop: rows[0] });
    res.json(rows[0]);
  } catch (e) { next(e); }
});
app.delete('/api/shops/:id', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM shops WHERE id=$1', [+req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------- visits ---------- */
app.post('/api/shops/:id/visits', requireAuth, async (req, res, next) => {
  try {
    const v = req.body;
    const { rows } = await pool.query(
      `INSERT INTO visits(shop_id,when_ts,materials,met,sale,follow_up,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [+req.params.id, v.when || new Date().toISOString().slice(0, 16),
       !!v.materials, !!v.met, !!v.sale, v.follow_up || null, v.notes || '']);
    const shop = (await pool.query('SELECT * FROM shops WHERE id=$1', [+req.params.id])).rows[0];
    notify('visit.logged', { shop, visit: visitOut(rows[0]) });
    res.json(visitOut(rows[0]));
  } catch (e) { next(e); }
});
app.delete('/api/visits/:id', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM visits WHERE id=$1', [+req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------- bulk import ---------- */
app.post('/api/import', requireAuth, async (req, res, next) => {
  try {
    const { market, records, replace } = req.body;
    if (!market || !Array.isArray(records)) return res.status(400).json({ error: 'market and records[] required' });
    const mk = await pool.query('SELECT slug FROM markets WHERE slug=$1', [market]);
    if (!mk.rows.length) return res.status(400).json({ error: 'unknown market: ' + market });
    if (replace) await pool.query('DELETE FROM shops WHERE market_slug=$1', [market]);
    const existing = new Set(
      (await pool.query('SELECT name,address FROM shops WHERE market_slug=$1', [market]))
        .rows.map(r => (r.name + '|' + r.address).toLowerCase()));
    let added = 0;
    for (const b of records) {
      if (!b.name) continue;
      const k = (b.name + '|' + (b.address || '')).toLowerCase();
      if (existing.has(k)) continue;
      existing.add(k);
      await insertShop(market, b);
      added++;
    }
    res.json({ added, skipped: records.length - added });
  } catch (e) { next(e); }
});

/* ---------- documents (contracts, sales sheets) ---------- */
app.get('/api/docs', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,title,filename,mime,size,share_token,created_at FROM documents ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { next(e); }
});
app.post('/api/docs', requireAuth, async (req, res, next) => {
  try {
    const { title, filename, mime, data_b64 } = req.body;
    if (!filename || !data_b64) return res.status(400).json({ error: 'filename and data_b64 required' });
    const buf = Buffer.from(data_b64, 'base64');
    if (buf.length > 20 * 1024 * 1024) return res.status(400).json({ error: 'file too large (20 MB max)' });
    const token = crypto.randomBytes(16).toString('hex');
    const { rows } = await pool.query(
      `INSERT INTO documents(title,filename,mime,size,share_token,data) VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id,title,filename,mime,size,share_token,created_at`,
      [title || filename, filename, mime || 'application/octet-stream', buf.length, token, buf]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});
app.delete('/api/docs/:id', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM documents WHERE id=$1', [+req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
// Public share link — unguessable token, no login needed so customers can open it
app.get('/d/:token', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT filename,mime,data FROM documents WHERE share_token=$1', [req.params.token]);
    if (!rows.length) return res.status(404).send('Document not found');
    const d = rows[0];
    res.setHeader('Content-Type', d.mime);
    res.setHeader('Content-Disposition', 'inline; filename="' + d.filename.replace(/"/g, '') + '"');
    res.send(d.data);
  } catch (e) { next(e); }
});

/* ---------- live rep position ---------- */
app.post('/api/position', requireAuth, async (req, res, next) => {
  try {
    const { device, label, lat, lng, accuracy } = req.body;
    if (!device || !isFinite(+lat) || !isFinite(+lng)) return res.status(400).json({ error: 'device, lat, lng required' });
    await pool.query(
      `INSERT INTO positions(device,label,lat,lng,accuracy,updated_at) VALUES($1,$2,$3,$4,$5,now())
       ON CONFLICT (device) DO UPDATE SET label=EXCLUDED.label, lat=EXCLUDED.lat, lng=EXCLUDED.lng, accuracy=EXCLUDED.accuracy, updated_at=now()`,
      [device, label || 'Rep', +lat, +lng, isFinite(+accuracy) ? +accuracy : null]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
app.get('/api/position', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT device,label,lat,lng,accuracy,updated_at FROM positions WHERE updated_at > now() - interval '15 minutes'`);
    res.json(rows);
  } catch (e) { next(e); }
});

/* ---------- SEO audit (Blue Collar AI engine) ---------- */
function isPrivateHost(hRaw) {
  const h = String(hRaw || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '169.254.169.254') return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '::1' || h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true;
  return false;
}
app.get('/api/proxy', requireAuth, async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('missing url');
  let u; try { u = new URL(target); } catch (e) { return res.status(400).send('bad url'); }
  if (!/^https?:$/.test(u.protocol)) return res.status(400).send('only http/https');
  if (isPrivateHost(u.hostname)) return res.status(403).send('blocked host');
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(u.href, { signal: ctrl.signal, redirect: 'follow', headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none',
    } });
    const body = await r.text();
    res.set('Access-Control-Allow-Origin', '*');
    res.status(r.status).type('text/plain; charset=utf-8').send(body);
  } catch (e) { res.status(502).send('fetch failed'); } finally { clearTimeout(t); }
});
// Headless rendering (JS sites) via a rendering API — key stays server-side. Off until RENDER_API_KEY is set.
app.get('/api/render', requireAuth, async (req, res) => {
  const key = process.env.RENDER_API_KEY;
  if (!key) return res.status(503).send('render_not_configured');
  const target = req.query.url;
  if (!target) return res.status(400).send('missing url');
  let u; try { u = new URL(target); } catch (e) { return res.status(400).send('bad url'); }
  if (!/^https?:$/.test(u.protocol)) return res.status(400).send('only http/https');
  if (isPrivateHost(u.hostname)) return res.status(403).send('blocked host');
  const provider = (process.env.RENDER_PROVIDER || 'scrapingbee').toLowerCase();
  const api = provider === 'scraperapi'
    ? 'https://api.scraperapi.com/?api_key=' + encodeURIComponent(key) + '&render=true&url=' + encodeURIComponent(u.href)
    : 'https://app.scrapingbee.com/api/v1/?api_key=' + encodeURIComponent(key) + '&render_js=true&url=' + encodeURIComponent(u.href);
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(api, { signal: ctrl.signal });
    const body = await r.text();
    res.set('Access-Control-Allow-Origin', '*');
    res.status(r.ok ? 200 : 502).type('text/plain; charset=utf-8').send(body);
  } catch (e) { res.status(502).send('render failed'); } finally { clearTimeout(t); }
});
app.get('/api/seo-config', requireAuth, (req, res) => res.json({ psiKey: process.env.PAGESPEED_KEY || '', emailEnabled: !!process.env.RESEND_API_KEY, stripeEnabled: !!process.env.STRIPE_SECRET_KEY, reportPriceCents: REPORT_PRICE_CENTS, renderEnabled: !!process.env.RENDER_API_KEY }));
async function sendEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'email_not_configured' };
  // Ensure the sender shows a friendly display name ("Blue Collar AI"), not a bare address,
  // regardless of how MAIL_FROM is set. Resend expects the format: Name <address>.
  let from = (process.env.MAIL_FROM || 'reports@towgrade.com').trim();
  const lt = from.indexOf('<');
  const hasName = lt > 0 && from.slice(0, lt).trim().length > 0;
  if (!hasName) { const addr = from.replace(/[<>]/g, '').trim(); from = 'Blue Collar AI <' + addr + '>'; }
  try {
    const body = { from, to: Array.isArray(to) ? to : [to], subject, html }; if (text) body.text = text;
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const t = await r.text().catch(() => ''); return { ok: false, status: r.status, body: t }; }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
app.post('/api/send-report', requireAuth, async (req, res) => {
  const { to, subject, html, text } = req.body || {};
  if (!to || !/.+@.+\..+/.test(to) || !html) return res.status(400).json({ error: 'to_and_html_required' });
  if (!process.env.RESEND_API_KEY) return res.status(503).json({ error: 'email_not_configured' });
  const r = await sendEmail({ to, subject: subject || 'Your SEO Audit', html, text });
  if (r && r.ok) return res.json({ ok: true });
  return res.status(502).json({ error: 'send_failed', detail: (r && (r.body || r.error)) || null });
});
// Geocode a place (for radius search centers)
app.get('/api/geocode', requireAuth, async (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.PLACES_API_KEY;
  if (!key) return res.status(503).json({ error: 'geocode_not_configured' });
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const j = await fetch('https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(q) + '&key=' + key).then(r => r.json());
    const loc = j.results && j.results[0] && j.results[0].geometry && j.results[0].geometry.location;
    if (!loc) return res.json({ found: false });
    res.json({ found: true, lat: loc.lat, lng: loc.lng });
  } catch (e) { res.status(502).json({ error: 'geocode_failed' }); }
});
// Google Places lookup — find a business's website/phone from name + location (field speed)
app.get('/api/places', requireAuth, async (req, res) => {
  const key = process.env.PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(503).json({ error: 'places_not_configured' });
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const ts = await fetch('https://maps.googleapis.com/maps/api/place/textsearch/json?query=' + encodeURIComponent(q) + '&key=' + key).then(r => r.json());
    const first = ts.results && ts.results[0];
    if (!first) return res.json({ found: false });
    const det = await fetch('https://maps.googleapis.com/maps/api/place/details/json?place_id=' + first.place_id + '&fields=name,website,formatted_phone_number,formatted_address&key=' + key).then(r => r.json());
    const d = det.result || {};
    res.json({ found: true, name: d.name || '', website: d.website || '', phone: d.formatted_phone_number || '', address: d.formatted_address || '' });
  } catch (e) { res.status(502).json({ error: 'places_failed' }); }
});
app.post('/api/shops/:id/audit', requireAuth, async (req, res, next) => {
  try {
    const { report, score, grade } = req.body || {};
    if (!report) return res.status(400).json({ error: 'report required' });
    const { rows } = await pool.query(
      'UPDATE shops SET last_report=$1, latest_score=$2, latest_grade=$3, last_audit_at=now(), updated_at=now() WHERE id=$4 RETURNING *',
      [JSON.stringify(report), (score == null ? null : score), grade || null, +req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    await pool.query('INSERT INTO audits(shop_id,report,score,grade) VALUES($1,$2,$3,$4)',
      [+req.params.id, JSON.stringify(report), (score == null ? null : score), grade || null]);
    notify('seo.audited', { shop: rows[0] });
    res.json(rows[0]);
  } catch (e) { next(e); }
});
app.get('/api/shops/:id/audits', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id,score,grade,created_at FROM audits WHERE shop_id=$1 ORDER BY created_at DESC LIMIT 50', [+req.params.id]);
    res.json(rows);
  } catch (e) { next(e); }
});
app.get('/api/audits/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT report FROM audits WHERE id=$1', [+req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

/* ---------- $49 hosted report (Stripe DIY) ---------- */
async function stripeCheckout(base, token, name) {
  const key = process.env.STRIPE_SECRET_KEY; if (!key) return null;
  const p = new URLSearchParams();
  p.set('mode', 'payment'); p.set('success_url', base + '/r/' + token + '?session_id={CHECKOUT_SESSION_ID}'); p.set('cancel_url', base + '/r/' + token);
  p.set('client_reference_id', token); p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', 'usd'); p.set('line_items[0][price_data][unit_amount]', String(REPORT_PRICE_CENTS));
  p.set('line_items[0][price_data][product_data][name]', 'Full SEO & AI Search Report' + (name ? (' — ' + name) : ''));
  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: p.toString() });
    if (!r.ok) { console.error('stripe', r.status, await r.text().catch(() => '')); return null; }
    return (await r.json()).url;
  } catch (e) { return null; }
}
async function stripePaid(sid) {
  const key = process.env.STRIPE_SECRET_KEY; if (!key || !sid) return false;
  try { const r = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sid), { headers: { 'Authorization': 'Bearer ' + key } }); if (!r.ok) return false; return (await r.json()).payment_status === 'paid'; } catch (e) { return false; }
}
app.post('/api/shared', requireAuth, async (req, res, next) => {
  try {
    const { report, name, summary } = req.body || {}; if (!report) return res.status(400).json({ error: 'report required' });
    const token = crypto.randomBytes(9).toString('hex');
    await pool.query('INSERT INTO shared_reports(token,name,report,summary) VALUES($1,$2,$3,$4)', [token, name || null, JSON.stringify(report), summary ? JSON.stringify(summary) : null]);
    const base = baseUrl(req);
    res.json({ token, url: base + '/r/' + token, buy: base + '/buy/' + token });
  } catch (e) { next(e); }
});
app.get('/api/shared/:token', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT name,report,summary,paid FROM shared_reports WHERE token=$1', [req.params.token]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const row = rows[0];
    res.json({ name: row.name, paid: row.paid, summary: row.summary, report: row.paid ? row.report : null, stripeEnabled: !!process.env.STRIPE_SECRET_KEY });
  } catch (e) { next(e); }
});
app.post('/api/shared/:token/claim', async (req, res, next) => {
  try {
    const paid = await stripePaid((req.body || {}).session_id);
    if (!paid) return res.json({ paid: false });
    await pool.query('UPDATE shared_reports SET paid=true, stripe_session=$1 WHERE token=$2', [(req.body || {}).session_id || null, req.params.token]);
    const { rows } = await pool.query('SELECT name,report,summary FROM shared_reports WHERE token=$1', [req.params.token]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json({ paid: true, name: rows[0].name, report: rows[0].report, summary: rows[0].summary });
  } catch (e) { next(e); }
});
app.get('/buy/:token', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT name FROM shared_reports WHERE token=$1', [req.params.token]);
    if (!rows.length) return res.status(404).send('Report not found');
    if (!process.env.STRIPE_SECRET_KEY) return res.redirect('/r/' + req.params.token + '?nostripe=1');
    const url = await stripeCheckout(baseUrl(req), req.params.token, rows[0].name);
    return url ? res.redirect(url) : res.redirect('/r/' + req.params.token + '?payerr=1');
  } catch (e) { next(e); }
});
app.get('/r/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'report.html')));

/* ---------- static ---------- */
app.get('/', (req, res) => {
  if (!authed(req)) return res.redirect('/login.html');
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  setHeaders: (res, p) => { if (p.endsWith('.html')) res.set('Cache-Control', 'no-cache'); },
}));
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server error' });
});

init().then(() => {
  app.listen(PORT, () => console.log('Field CRM running on port ' + PORT));
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });
