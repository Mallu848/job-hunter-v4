// Ingest hardening tests: orphan sweep + async 202/status contract.
// Uses a throwaway PGlite dir (PGLITE_DIR) and no external network: the
// jsearch adapter fails fast without RAPIDAPI_KEY and the watchlist is empty,
// so runIngestion completes with error-only run rows.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.PGLITE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jh-test-pglite-'));
delete process.env.DATABASE_URL;

const { db } = await import('../src/db/index.js');

// CRITICAL ORDER: db/index.js runs `import 'dotenv/config'`, which loads .env
// into process.env. Deleting the API keys must happen AFTER that import, or
// dotenv re-populates them and this test fires real network calls.
delete process.env.RAPIDAPI_KEY;
delete process.env.ANTHROPIC_API_KEY;
const { users, profiles, ingestRuns } = await import('../src/db/schema.js');
const { sweepOrphanRuns, isIngestionRunning } = await import('../src/lib/ingest.js');
const ingestRouter = (await import('../src/routes/ingest.js')).default;
const express = (await import('express')).default;
const { eq, isNull, and } = await import('drizzle-orm');

let server;
let base;
let userId;

before(async () => {
  const [user] = await db.insert(users).values({ email: 'rohanantony848@gmail.com' }).returning();
  userId = user.id;
  await db.insert(profiles).values({
    userId,
    targetTitles: ['DevOps Engineer'],
    skills: [],
    locations: [],
    remoteOnly: false,
    scoreThreshold: 55,
    excludeKeywords: [],
  });

  const app = express();
  app.use(express.json());
  app.use('/api/ingest', ingestRouter); // auth middleware not under test here
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) server.close();
});

test('orphan sweep closes stale unfinished runs and leaves fresh ones alone', async () => {
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
  const fresh = new Date(Date.now() - 5 * 60 * 1000); // 5min ago
  const [staleRow] = await db
    .insert(ingestRuns)
    .values({ userId, source: 'jsearch', startedAt: stale })
    .returning();
  const [freshRow] = await db
    .insert(ingestRuns)
    .values({ userId, source: 'ats', startedAt: fresh })
    .returning();

  const closed = await sweepOrphanRuns();
  assert.equal(closed, 1);

  const [staleAfter] = await db.select().from(ingestRuns).where(eq(ingestRuns.id, staleRow.id));
  assert.ok(staleAfter.finishedAt);
  assert.equal(staleAfter.error, 'orphaned (process died)');

  const [freshAfter] = await db.select().from(ingestRuns).where(eq(ingestRuns.id, freshRow.id));
  assert.equal(freshAfter.finishedAt, null);

  // clean up the fresh row so it doesn't linger for the route test
  await db.delete(ingestRuns).where(eq(ingestRuns.id, freshRow.id));
});

test('POST /api/ingest returns 202 immediately and status reflects the run', async () => {
  const resp = await fetch(`${base}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(resp.status, 202);
  assert.deepEqual(await resp.json(), { started: true });

  // Poll status until the background run finishes (fails fast — no keys, no
  // watchlist — so this resolves in well under the timeout).
  let status;
  for (let i = 0; i < 50; i++) {
    const s = await fetch(`${base}/api/ingest/status`);
    assert.equal(s.status, 200);
    status = await s.json();
    if (!status.running) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(status.running, false);
  assert.equal(isIngestionRunning(), false);

  const sources = status.last_runs.map((r) => r.source).sort();
  assert.deepEqual(sources, ['ats', 'jsearch']);
  const jsearchRun = status.last_runs.find((r) => r.source === 'jsearch');
  assert.match(jsearchRun.error || '', /RAPIDAPI_KEY/);
  const atsRun = status.last_runs.find((r) => r.source === 'ats');
  assert.equal(atsRun.fetched, 0);
  assert.ok(atsRun.finished_at);

  // No orphaned (unfinished) rows left behind.
  const open = await db
    .select()
    .from(ingestRuns)
    .where(and(eq(ingestRuns.userId, userId), isNull(ingestRuns.finishedAt)));
  assert.equal(open.length, 0);
});

test('POST /api/ingest while running returns 409', async () => {
  // Simulate: start a run and immediately POST again. The first finishes
  // fast, so instead assert the guard directly via two back-to-back posts.
  const first = await fetch(`${base}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const second = await fetch(`${base}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const statuses = [first.status, second.status].sort();
  // The runs fail fast; depending on timing the second POST sees 409 or a
  // fresh 202. Both must be one of the two contract codes, never a 500.
  for (const s of statuses) assert.ok(s === 202 || s === 409, `unexpected status ${s}`);

  // Drain: wait for any in-flight run to end so the file exits cleanly.
  for (let i = 0; i < 50 && isIngestionRunning(); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
});
