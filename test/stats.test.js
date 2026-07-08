import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldStats } from '../src/lib/stats.js';

test('pipeline counts are zero-filled for all five statuses', () => {
  const out = foldStats([{ id: 1, status: 'applied', resume_id: null }], []);
  assert.deepEqual(out.pipeline, { saved: 0, applied: 1, interview: 0, rejected: 0, offer: 0 });
});

test('ever-reached folds events plus current status, deduped per app', () => {
  const apps = [
    { id: 1, status: 'interview', resume_id: null }, // reached applied via events
    { id: 2, status: 'applied', resume_id: null }, // created directly as applied, no events
    { id: 3, status: 'rejected', resume_id: null }, // applied -> rejected
  ];
  const events = [
    { application_id: 1, to_status: 'saved' },
    { application_id: 1, to_status: 'applied' },
    { application_id: 1, to_status: 'interview' },
    { application_id: 1, to_status: 'interview' }, // duplicate event must not double-count
    { application_id: 3, to_status: 'applied' },
    { application_id: 3, to_status: 'rejected' },
  ];
  const out = foldStats(apps, events);
  assert.equal(out.funnel.ever_applied, 3);
  assert.equal(out.funnel.ever_interview, 1);
  assert.equal(out.funnel.ever_offer, 0);
  assert.equal(out.funnel.ever_rejected, 1);
  assert.equal(out.funnel.applied_to_interview, 0.333);
  assert.equal(out.funnel.interview_to_offer, 0); // 0/1 is a real 0, not null
});

test('zero denominators produce null rates, never NaN', () => {
  const out = foldStats([{ id: 1, status: 'saved', resume_id: null }], []);
  assert.equal(out.funnel.applied_to_interview, null);
  assert.equal(out.funnel.interview_to_offer, null);
  assert.doesNotMatch(JSON.stringify(out), /NaN/);
});

test('variant grouping: tailored variants and untailored fallback', () => {
  const apps = [
    { id: 1, status: 'applied', resume_id: 10 },
    { id: 2, status: 'interview', resume_id: 10 },
    { id: 3, status: 'applied', resume_id: null }, // untailored
    { id: 4, status: 'applied', resume_id: 99 }, // resume with no variant -> untailored
  ];
  const events = [{ application_id: 2, to_status: 'applied' }];
  const variants = new Map([[10, 'azure_administrator']]);

  const out = foldStats(apps, events, variants);
  const azure = out.by_variant.find((v) => v.variant === 'azure_administrator');
  assert.deepEqual(azure, {
    variant: 'azure_administrator',
    ever_applied: 2,
    ever_interview: 1,
    applied_to_interview: 0.5,
  });
  const untailored = out.by_variant.find((v) => v.variant === 'untailored');
  assert.equal(untailored.ever_applied, 2);
  assert.equal(untailored.ever_interview, 0);
  assert.equal(untailored.applied_to_interview, 0);
});

test('variant group with zero applied has null rate', () => {
  const out = foldStats([{ id: 1, status: 'saved', resume_id: null }], []);
  const untailored = out.by_variant.find((v) => v.variant === 'untailored');
  assert.equal(untailored.ever_applied, 0);
  assert.equal(untailored.applied_to_interview, null);
});

test('empty inputs produce a fully-shaped, all-zero response', () => {
  const out = foldStats([], []);
  assert.deepEqual(out.pipeline, { saved: 0, applied: 0, interview: 0, rejected: 0, offer: 0 });
  assert.equal(out.funnel.ever_applied, 0);
  assert.equal(out.funnel.applied_to_interview, null);
  assert.deepEqual(out.by_variant, []);
});
