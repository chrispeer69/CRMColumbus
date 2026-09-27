'use strict';
// Auth audit (npm test): every route the server registers must either be on the PUBLIC_ROUTES list in server.js or
// refuse an anonymous request (401, or a redirect to /login.html for pages). A new route added without requireAuth
// fails this test until it is protected — or deliberately listed as public. No database is needed: protected
// routes reject before they touch it.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
const test = require('node:test');
const assert = require('node:assert');
const { app, PUBLIC_ROUTES } = require('../server');

function routes() {
  const out = [];
  (app._router.stack || []).forEach(l => {
    if (!l.route) return;
    const paths = [].concat(l.route.path);
    Object.keys(l.route.methods).filter(m => l.route.methods[m]).forEach(m => paths.forEach(p => out.push({ method: m.toUpperCase(), path: p })));
  });
  return out;
}
const sample = p => p.replace(/:id\b/g, '1').replace(/:token\b/g, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').replace(/:name\b/g, 'towing.json');

let server, base;
test.before(async () => { await new Promise(r => { server = app.listen(0, r); }); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => { server.close(); if (typeof app.locals.pool === 'object') app.locals.pool.end(); });

test('every public route in the allowlist exists', () => {
  const have = new Set(routes().map(r => r.method + ' ' + r.path));
  PUBLIC_ROUTES.forEach(k => assert.ok(have.has(k), 'PUBLIC_ROUTES lists a route that does not exist: ' + k));
});

test('every non-public route refuses an anonymous request', async () => {
  const pub = new Set(PUBLIC_ROUTES);
  const protectedRoutes = routes().filter(r => !pub.has(r.method + ' ' + r.path));
  assert.ok(protectedRoutes.length > 25, 'expected the CRM API routes, found ' + protectedRoutes.length);
  const leaks = [];
  for (const r of protectedRoutes) {
    const res = await fetch(base + sample(r.path), { method: r.method, redirect: 'manual', headers: { 'Content-Type': 'application/json' }, body: r.method === 'GET' ? undefined : '{}' });
    const loc = res.headers.get('location') || '';
    const ok = res.status === 401 || ((res.status === 302 || res.status === 303) && /\/login\.html$/.test(loc));
    if (!ok) leaks.push(r.method + ' ' + r.path + ' → ' + res.status + (loc ? ' ' + loc : ''));
  }
  assert.deepStrictEqual(leaks, [], 'routes answering without a login:\n' + leaks.join('\n'));
});

test('no file outside the allowlist is served (incl. encoded-path tricks)', async () => {
  for (const p of ['/index.html', '/%69ndex.html', '/index.html%00', '/public/index.html', '/server.js', '/package.json', '/seed.json', '/.env', '/_audit_test.js', '/%2e%2e/server.js']) {
    const res = await fetch(base + p, { redirect: 'manual' });
    const body = res.status === 200 ? await res.text() : '';
    assert.ok(res.status !== 200 || !/SEO\.|state\.businesses|require\(/.test(body), p + ' served content without a login (' + res.status + ')');
  }
  const idx = await fetch(base + '/index.html', { redirect: 'manual' });
  assert.ok([302, 303].includes(idx.status) && /login\.html$/.test(idx.headers.get('location') || ''), '/index.html must redirect to login');
});

test('the public pages stay reachable', async () => {
  for (const [p, want] of [['/login.html', 200], ['/healthz', 200], ['/api/me', 200], ['/api/sso', 200]]) {
    const res = await fetch(base + p, { redirect: 'manual' });
    assert.strictEqual(res.status, want, p);
  }
  const me = await (await fetch(base + '/api/me')).json();
  assert.strictEqual(me.authed, false);
});

test('a forged or stale cookie is not a login', async () => {
  const res = await fetch(base + '/api/shops', { headers: { Cookie: 'fcrm=' + 'f'.repeat(64) } });
  assert.strictEqual(res.status, 401);
});
