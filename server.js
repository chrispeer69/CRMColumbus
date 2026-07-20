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
    ADD COLUMN IF NOT EXISTS last_audit_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS last_report JSONB`);
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
  'owner_name', 'owner_phone', 'owner_email', 'manager_name', 'manager_phone', 'manager_email', 'alliance_status'];
function shopVals(b) {
  return [b.name || '', b.address || '', b.zip || '', b.phone || '', b.email || '', b.web || '',
    b.contact || '', b.category || 'repair',
    isFinite(+b.lat) ? +b.lat : null, isFinite(+b.lng) ? +b.lng : null, b.notes || '',
    b.owner_name || '', b.owner_phone || '', b.owner_email || '',
    b.manager_name || '', b.manager_phone || '', b.manager_email || '', b.alliance_status || ''];
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
app.get('/api/seo-config', requireAuth, (req, res) => res.json({ psiKey: process.env.PAGESPEED_KEY || '' }));
app.post('/api/shops/:id/audit', requireAuth, async (req, res, next) => {
  try {
    const { report, score, grade } = req.body || {};
    if (!report) return res.status(400).json({ error: 'report required' });
    const { rows } = await pool.query(
      'UPDATE shops SET last_report=$1, latest_score=$2, latest_grade=$3, last_audit_at=now(), updated_at=now() WHERE id=$4 RETURNING *',
      [JSON.stringify(report), (score == null ? null : score), grade || null, +req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    notify('seo.audited', { shop: rows[0] });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

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
