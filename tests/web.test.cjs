const { test } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../build/web/app').default;
const request = (path, method = 'GET') => app.fetch(new Request(`http://localhost${path}`, { method }));

test('home connects to health, with no draw or mail endpoint', async () => {
  const home = request('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /secretGift/);
  assert.match(await request('/status.js').text(), /fetch\('\/api\/health'/);
  for (const path of ['/api/draw', '/api/mail', '/.env', '/participants.json']) {
    assert.equal(request(path).status, 404);
  }
});
test('health exposes only operational status and cannot be mutated', async () => {
  assert.deepEqual(await request('/api/health').json(), { status: 'ok' });
  assert.equal(request('/api/health', 'POST').status, 405);
  assert.equal(await request('/api/health', 'HEAD').text(), '');
});

test('Node HTTP server serves the existing routes without CLI or SMTP', async (t) => {
  const { createWebServer } = require('../build/web/server');
  const server = createWebServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.match(await (await fetch(base)).text(), /secretGift/);
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal(await (await fetch(`${base}/api/health`, { method: 'HEAD' })).text(), '');
  assert.equal((await fetch(`${base}/api/health`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/api/draw`)).status, 404);
  assert.equal((await fetch(`${base}/api/mail`)).status, 404);
});
