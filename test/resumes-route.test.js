// Master render-on-the-fly: GET /api/resumes/:id must include rendered_html
// for a structured master (computed live) and leave it null for a raw_text
// master. Throwaway PGlite dir; no network.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

process.env.PGLITE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jh-test-pglite-'));
delete process.env.DATABASE_URL;

const { db } = await import('../src/db/index.js');

// dotenv (loaded by db/index.js) re-populates .env keys — strip AFTER import.
delete process.env.RAPIDAPI_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { users, resumes } = await import('../src/db/schema.js');
const resumesRouter = (await import('../src/routes/resumes.js')).default;
const express = (await import('express')).default;

const structuredMaster = {
  contact: { name: 'Rohan A', location: 'Chicago, IL', email: 'r@x.test' },
  summary_variants: { a: 'Azure-focused analyst.' },
  skills: [{ group: 'Identity', items: [{ name: 'Entra ID', aliases: [] }] }],
  experience: [
    {
      company: 'Auto Approve',
      title: 'Senior IT Analyst',
      location: 'Chicago, IL',
      start: '2022',
      end: 'Present',
      bullets: [{ text: 'Managed identity for 300 users.', tags: [] }],
    },
  ],
  education: [],
  certifications: [],
};

let server;
let base;
let structuredId;
let rawId;

before(async () => {
  const [user] = await db.insert(users).values({ email: 'owner@example.com' }).returning();

  const [structured] = await db
    .insert(resumes)
    .values({ userId: user.id, kind: 'master', content: structuredMaster })
    .returning();
  structuredId = structured.id;

  const [raw] = await db
    .insert(resumes)
    .values({ userId: user.id, kind: 'master', content: { raw_text: 'plain text resume' } })
    .returning();
  rawId = raw.id;

  const app = express();
  app.use(express.json());
  app.use('/api/resumes', resumesRouter);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
});

test('structured master gets rendered_html computed on the fly', async () => {
  const resp = await fetch(`${base}/api/resumes/${structuredId}`);
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.kind, 'master');
  assert.ok(body.rendered_html, 'rendered_html should be present');
  assert.match(body.rendered_html, /^<!doctype html>/);
  assert.match(body.rendered_html, /Rohan A/);
  assert.match(body.rendered_html, /Managed identity for 300 users\./);
  assert.match(body.rendered_html, /@media print/);
});

test('raw_text-only master keeps rendered_html null', async () => {
  const resp = await fetch(`${base}/api/resumes/${rawId}`);
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.rendered_html, null);
});
