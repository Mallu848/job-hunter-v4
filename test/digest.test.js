import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDigest } from '../src/lib/digest-format.js';

function match(score, title, extra = {}) {
  return { score, title, company: 'Co', location: 'Remote', url: 'https://x.test/j', reasons: ['fit'], ...extra };
}

test('digest sorts by score desc and caps at top 5', () => {
  const matches = [55, 90, 70, 60, 85, 99].map((s) => match(s, `Job${s}`));
  const text = formatDigest({ matches, scannedCount: 6, threshold: 55 });
  assert.match(text, /1\) 99 — Job99/);
  assert.match(text, /2\) 90 — Job90/);
  assert.match(text, /5\) 60 — Job60/);
  assert.doesNotMatch(text, /Job55/); // 6th best cut by top-5 cap
  assert.match(text, /5 new matches/);
});

test('digest lines include location, reasons, and url', () => {
  const text = formatDigest({
    matches: [match(87, 'Azure Administrator', { company: 'Contoso' })],
    scannedCount: 3,
    threshold: 55,
  });
  assert.match(text, /1\) 87 — Azure Administrator @ Contoso \(Remote\)/);
  assert.match(text, /why: fit/);
  assert.match(text, /https:\/\/x\.test\/j/);
  assert.match(text, /1 new match\n/);
});

test('zero matches produces the none-above-bar message', () => {
  const text = formatDigest({ matches: [], scannedCount: 12, threshold: 55 });
  assert.equal(text, 'Job Hunter digest — scanned 12 new jobs, none above your bar (threshold 55).');
});

test('test prefix appears in header', () => {
  const text = formatDigest({ matches: [], scannedCount: 0, threshold: 55, testPrefix: true });
  assert.match(text, /^\[test\] Job Hunter digest/);
});
