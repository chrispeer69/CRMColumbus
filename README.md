# Field CRM

Map-first CRM for door-to-door field sales reps. Columbus, OH is the first market — the app is built as a **multi-city template**: every shop belongs to a market, and new cities are added right from the UI.

## Features

- **Interactive map** (Leaflet, dark theme) — color-coded pins: green = repair, blue = towing, red = body shop, yellow = visited, orange = follow-up due, green ring = sale closed
- **Live GPS** — track your phone on the map while driving a route; position is shared to the team map (other reps' phones show as labeled green dots)
- **Near Me** — closest unvisited shops from where you're standing
- **Full business details** — contact, phone, email, website, notes; everything editable in the field
- **Visit logging** — materials dropped / met owner / sale closed / follow-up date / notes, with full history
- **Add shops in the field** — pin by your GPS, by tapping the map, or by address lookup
- **Documents** — upload contracts and sales sheets, then **text or email them to a prospect mid-call** (one tap prefills their phone/email with a share link)
- **Multi-city** — market switcher in the header; **＋ City** geocodes and creates a new market
- **Import / Export** — bulk JSON import per market; GoHighLevel-ready CSV export; end-of-day visit notes CSV
- **Login** — shared team password, works on phones; sessions last 180 days

## Stack

Node.js + Express + PostgreSQL. Frontend is a single dependency-free page (Leaflet from CDN). Schema is created automatically on first boot, and the Columbus seed data (127 shops in `seed.json`) loads if the database is empty.

## Deploy on Railway

1. **New Project → Deploy from GitHub repo** → pick `chrispeer69/crmcolumbus`
2. In the project, **＋ New → Database → PostgreSQL**
3. On the app service → **Variables**:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (reference the Postgres service)
   - `APP_PASSWORD` = the team password reps type to sign in
   - `SESSION_SECRET` = any long random string
4. App service → **Settings → Networking → Generate Domain**

That's it — open the domain, sign in, and the map loads with Columbus seeded. HTTPS is automatic (required for phone GPS).

## Office notifications / GoHighLevel sync

Set a `NOTIFY_WEBHOOK_URL` variable on the Railway app service and the server POSTs JSON to it in real time on every field entry:

- `shop.created` — rep added a new business (full shop record)
- `shop.updated` — contact info / details changed
- `visit.logged` — visit logged (shop record + visit: met/sale/materials/follow-up/notes)

Point it at a GoHighLevel inbound-webhook workflow (or Zapier/Make) to auto-create/update GHL contacts and alert the office. Without the variable set, nothing is sent — the in-app GoHighLevel CSV export still works either way.

## Launching a new city

1. Sign in → **＋ City** → type e.g. `Cleveland, OH` (centers the map automatically)
2. Build a JSON list of businesses (name, address, lat, lng, category, phone, …)
3. **Import** → paste the array → **Add to map**

## Local development

```
npm install
set DATABASE_URL=postgres://user:pass@localhost:5432/fieldcrm
set APP_PASSWORD=test
npm start
```

## API sketch

`POST /api/login` · `GET /api/shops?market=` · `POST /api/shops` · `PUT /api/shops/:id` · `DELETE /api/shops/:id` · `POST /api/shops/:id/visits` · `POST /api/import` · `GET/POST /api/docs` · `GET /d/:token` (public doc share link) · `GET/POST /api/position` (live rep locations) · `GET/POST /api/markets`
