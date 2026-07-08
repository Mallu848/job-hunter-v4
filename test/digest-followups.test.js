import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFollowups, formatDigest, FOLLOWUP_CAP } from '../src/lib/digest-format.js';

const NOW = new Date('2026-07-15T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function appliedApp(daysAgo, overrides = {}) {
  return {
    status: 'applied',
    applied_at: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    next_action: null,
    next_action_date: null,
    job: { title: 'DevOps Engineer', company: 'Acme' },
    ...overrides,
  };
}

test('stale-applied window is [7, 21) whole days', () => {
  assert.equal(computeFollowups([appliedApp(6)], NOW).length, 0); // 6d no
  assert.equal(computeFollowups([appliedApp(7)], NOW).length, 1); // 7d yes
  assert.equal(computeFollowups([appliedApp(20)], NOW).length, 1); // 20d yes
  assert.equal(computeFollowups([appliedApp(21)], NOW).length, 0); // 21d no
});

test('stale line format and N days', () => {
  const [line] = computeFollowups([appliedApp(10)], NOW);
  assert.equal(line, 'Follow up: DevOps Engineer @ Acme — applied 10d ago');
});

test('non-applied statuses never produce stale lines', () => {
  assert.equal(computeFollowups([appliedApp(10, { status: 'interview' })], NOW).length, 0);
});

test('overdue next action included for active statuses, excluded for rejected/offer', () => {
  const base = {
    status: 'interview',
    applied_at: null,
    next_action: 'Send thank-you note',
    next_action_date: '2026-07-14',
    job: { title: 'Cloud Engineer', company: 'Beta' },
  };
  const [line] = computeFollowups([base], NOW);
  assert.equal(line, 'Due: Send thank-you note — Cloud Engineer @ Beta');

  assert.equal(computeFollowups([{ ...base, status: 'rejected' }], NOW).length, 0);
  assert.equal(computeFollowups([{ ...base, status: 'offer' }], NOW).length, 0);
});

test('overdue uses UTC date compare: today counts, tomorrow does not', () => {
  const base = {
    status: 'saved',
    next_action: null,
    next_action_date: '2026-07-15', // == today UTC
    job: { title: 'T', company: 'C' },
  };
  const [line] = computeFollowups([base], NOW);
  assert.equal(line, 'Due: next action — T @ C'); // fallback label too
  assert.equal(computeFollowups([{ ...base, next_action_date: '2026-07-16' }], NOW).length, 0);
});

test('followups capped at 10, oldest applied first', () => {
  const apps = [];
  for (let d = 7; d <= 20; d++) apps.push(appliedApp(d, { job: { title: `Job${d}`, company: 'X' } }));
  const lines = computeFollowups(apps, NOW);
  assert.equal(lines.length, FOLLOWUP_CAP);
  assert.match(lines[0], /Job20/); // oldest applied (20d ago) first
  assert.match(lines[9], /Job11/);
});

test('formatDigest appends FOLLOW-UPS section only when non-empty', () => {
  const base = { matches: [], scannedCount: 3, threshold: 55 };
  const without = formatDigest({ ...base, followups: [] });
  assert.doesNotMatch(without, /FOLLOW-UPS/);

  const withF = formatDigest({ ...base, followups: ['Follow up: X @ Y — applied 8d ago'] });
  assert.match(withF, /\n\nFOLLOW-UPS\nFollow up: X @ Y — applied 8d ago$/);

  // Also appended after a matches section, and TOP_N behavior untouched.
  const matches = [{ score: 80, title: 'T', company: 'C', location: '', url: '', reasons: [] }];
  const both = formatDigest({ ...base, matches, followups: ['Due: call — T @ C'] });
  assert.match(both, /1\) 80 — T @ C/);
  assert.match(both, /FOLLOW-UPS\nDue: call — T @ C$/);
});
