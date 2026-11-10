const { test } = require('node:test');
const assert = require('node:assert/strict');
const worker = require('../build/web/worker').default;
const request = (path, method = 'GET') => worker.fetch(new Request(`http://localhost${path}`, { method }));

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
