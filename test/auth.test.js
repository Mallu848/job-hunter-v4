import test from 'node:test';
import assert from 'node:assert/strict';
process.env.APP_SECRET = 'a'.repeat(32);
const { requireAppSecret, _resetAuthLimiter } = await import('../src/lib/auth.js');

function run(secret, ip = '1.2.3.4') {
  let status = 200;
  const res = { set() {}, status(s) { status = s; return this; }, json() { return this; } };
  const req = { ip, header: () => secret };
  let passed = false;
  requireAppSecret(req, res, () => { passed = true; });
  return { status, passed };
}

test('valid secret passes, bad secret 401', () => {
  _resetAuthLimiter();
  assert.equal(run(process.env.APP_SECRET).passed, true);
  assert.equal(run('nope').status, 401);
});

test('locks out after 10 failures, even with right secret', () => {
  _resetAuthLimiter();
  for (let i = 0; i < 10; i++) assert.equal(run('bad').status, 401);
  assert.equal(run('bad').status, 429);
  assert.equal(run(process.env.APP_SECRET).status, 429);
  assert.equal(run(process.env.APP_SECRET, '9.9.9.9').passed, true);
});
