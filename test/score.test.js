import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScorePrompt, scoreJob } from '../src/lib/score-core.js';

const profile = {
  targetTitles: ['DevOps Engineer', 'Azure Administrator'],
  skills: ['Azure', 'PowerShell'],
  minSalary: 90000,
  locations: ['Remote (US)', 'Chicago, IL'],
};

const job = {
  title: 'Cloud Engineer',
  company: 'Acme',
  location: 'Remote',
  salaryText: '$100K',
  description: 'D'.repeat(9000),
};

test('prompt includes profile fields and job facts', () => {
  const p = buildScorePrompt(job, profile, 'RESUME TEXT');
  assert.match(p, /DevOps Engineer, Azure Administrator/);
  assert.match(p, /Azure, PowerShell/);
  assert.match(p, /\$90000/);
  assert.match(p, /Cloud Engineer/);
  assert.match(p, /Acme/);
  assert.match(p, /RESUME TEXT/);
});

test('prompt renders the location constraint from profile.locations', () => {
  const p = buildScorePrompt(job, profile, 'RESUME TEXT');
  assert.match(p, /CANDIDATE LOCATION CONSTRAINT/);
  assert.match(p, /Acceptable locations: Remote \(US\), Chicago, IL\./);
  assert.match(p, /can ONLY work US-remote or in\/near these locations/);
  assert.match(p, /cap the score at 30/);
});

test('prompt falls back to US-remote when locations is empty', () => {
  const p = buildScorePrompt(job, { ...profile, locations: [] }, 'x');
  assert.match(p, /Acceptable locations: US-remote\./);
});

test('prompt truncates resume to 4000 and description to 6000 chars', () => {
  const p = buildScorePrompt(job, profile, 'R'.repeat(10000));
  assert.match(p, /R{4000}/); // resume kept to exactly 4000...
  assert.doesNotMatch(p, /R{4001}/); // ...and not one char more
  assert.match(p, /D{6000}/);
  assert.doesNotMatch(p, /D{6001}/);
});

function fakeAnthropicResponse(text, usage = { input_tokens: 100, output_tokens: 50 }) {
  return {
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }], usage }),
  };
}

const goodJson =
  '{"score": 72, "reasons": ["strong Azure match"], "matched_skills": ["Azure"], "missing_keywords": ["Kubernetes"], "red_flags": []}';

test('scoreJob parses a valid first response (one call)', async () => {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return fakeAnthropicResponse(goodJson);
  };
  const { parsed, calls: usage } = await scoreJob(job, profile, 'resume', { fetch: fakeFetch });
  assert.equal(parsed.score, 72);
  assert.deepEqual(parsed.matched_skills, ['Azure']);
  assert.equal(calls, 1);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].inputTokens, 100);
});

test('scoreJob retries once on invalid JSON then succeeds', async () => {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
  let calls = 0;
  const fakeFetch = async (url, opts) => {
    calls++;
    if (calls === 1) return fakeAnthropicResponse('Sure! The score is about 72.');
    // Retry should carry the JSON nudge
    assert.match(JSON.parse(opts.body).messages[0].content, /not valid JSON/);
    return fakeAnthropicResponse(goodJson);
  };
  const { parsed, calls: usage } = await scoreJob(job, profile, 'resume', { fetch: fakeFetch });
  assert.equal(parsed.score, 72);
  assert.equal(calls, 2);
  assert.equal(usage.length, 2);
});

test('scoreJob throws after second bad response, with usage attached', async () => {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';
  const fakeFetch = async () => fakeAnthropicResponse('still not json');
  await assert.rejects(
    () => scoreJob(job, profile, 'resume', { fetch: fakeFetch }),
    (err) => {
      assert.equal(err.calls.length, 2);
      return true;
    },
  );
});
