import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passesPrefilter } from '../src/lib/prefilter.js';

const profile = {
  targetTitles: ['DevOps Engineer', 'Cloud Engineer', 'Azure Administrator', 'IT Systems Engineer'],
  excludeKeywords: ['clearance', 'intern'],
  remoteOnly: false,
};

test('passes on distinctive token match (devops)', () => {
  const r = passesPrefilter({ title: 'Senior DevOps Engineer' }, profile);
  assert.equal(r.pass, true);
});

test('passes on distinctive token from a different target (azure)', () => {
  const r = passesPrefilter({ title: 'Azure Infrastructure Lead' }, profile);
  assert.equal(r.pass, true);
});

test('rejects unrelated title even though it contains stopword "engineer"', () => {
  const r = passesPrefilter({ title: 'Mechanical Engineer' }, profile);
  assert.equal(r.pass, false);
});

test('rejects on exclude keyword in title', () => {
  const r = passesPrefilter({ title: 'DevOps Engineer (TS/SCI Clearance)' }, profile);
  assert.equal(r.pass, false);
  assert.match(r.reason, /clearance/);
});

test('rejects on exclude keyword in description', () => {
  const r = passesPrefilter(
    { title: 'Cloud Engineer', description: 'This is an intern position.' },
    profile,
  );
  assert.equal(r.pass, false);
});

test('remote_only rejects explicit non-remote job', () => {
  const r = passesPrefilter(
    { title: 'Cloud Engineer', remote: false },
    { ...profile, remoteOnly: true },
  );
  assert.equal(r.pass, false);
});

test('remote_only keeps job with unknown remote status (recall-biased)', () => {
  const r = passesPrefilter(
    { title: 'Cloud Engineer', remote: null },
    { ...profile, remoteOnly: true },
  );
  assert.equal(r.pass, true);
});

test('matching is case-insensitive and word-boundary aware', () => {
  assert.equal(passesPrefilter({ title: 'CLOUD OPERATIONS ANALYST' }, profile).pass, true);
  // "cloudy" must not match "cloud"
  assert.equal(passesPrefilter({ title: 'Cloudy Weather Reporter' }, profile).pass, false);
});

test('empty target titles passes everything through', () => {
  const r = passesPrefilter({ title: 'Anything At All' }, { targetTitles: [] });
  assert.equal(r.pass, true);
});

// ---------- Location gate ----------
// Title is always a matching one so only the location logic is under test.
function locCase(location, remote = null) {
  return passesPrefilter({ title: 'DevOps Engineer', location, remote }, profile);
}

test('location gate rejects explicit non-US locations', () => {
  assert.equal(locCase('Paris, France').pass, false);
  assert.equal(locCase('Paris, France').reason, 'non-us location');
  assert.equal(locCase('Sydney, Australia').pass, false);
  assert.equal(locCase('Warsaw, PL').pass, false);
  assert.equal(locCase('London, United Kingdom').pass, false);
});

test('location gate rejects non-US remote regions', () => {
  assert.equal(locCase('Remote - EMEA').pass, false);
  assert.equal(locCase('Remote, Canada').pass, false);
});

test('location gate passes US locations', () => {
  assert.equal(locCase('New York, NY').pass, true);
  assert.equal(locCase('Chicago, IL').pass, true);
  assert.equal(locCase('Remote (US)').pass, true);
});

test('location gate keeps plain/unknown locations (recall-biased)', () => {
  assert.equal(locCase('Remote').pass, true);
  assert.equal(locCase('').pass, true);
  assert.equal(locCase(null).pass, true);
});

test('explicit remote flag wins over a non-US location string', () => {
  assert.equal(locCase('Dublin, Ireland', true).pass, true);
});

test('US-vs-country code collisions resolve US-first (IL, CA)', () => {
  assert.equal(locCase('Springfield, IL').pass, true); // IL = Illinois, not Israel
  assert.equal(locCase('San Jose, CA').pass, true); // CA = California, not Canada
  assert.equal(locCase('Tel Aviv, Israel').pass, false);
  assert.equal(locCase('Toronto, Canada').pass, false);
});
