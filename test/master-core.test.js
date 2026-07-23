// master-core: the schema that guards every saved master, and parseResumeText
// (the .docx import's AI step) with a mocked Anthropic call — no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'test-key'; // callAnthropic requires it set

const { masterSchema, friendlyZodError, buildParsePrompt, parseResumeText, PARSE_MODEL } =
  await import('../src/lib/master-core.js');

const validMaster = {
  contact: { name: 'Rohan Antony', email: 'r@x.test', location: 'Chicago, IL' },
  summary_variants: { azure_administrator: 'Azure-focused IT analyst.' },
  skills: [{ group: 'Identity', items: [{ name: 'Microsoft Entra ID', aliases: ['Azure AD'] }] }],
  experience: [
    {
      company: 'Auto Approve',
      title: 'Senior IT Analyst',
      start: 'Feb 2022',
      end: 'Present',
      bullets: [{ text: 'Automated onboarding for 300 users.' }],
    },
  ],
  education: [{ school: 'DePaul University', degree: 'BS MIS', graduated: 'Jun 2021' }],
  certifications: [{ name: 'AZ-104' }],
};

test('masterSchema accepts a valid master and fills defaults', () => {
  const parsed = masterSchema.parse(validMaster);
  assert.deepEqual(parsed.experience[0].bullets[0].tags, []); // default added
  assert.equal(parsed.certifications[0].date, null); // nullable default
  assert.equal(parsed.education[0].location, ''); // string default
  assert.deepEqual(parsed.skills[0].items[0].aliases, ['Azure AD']);
});

test('masterSchema rejects a master with no experience', () => {
  assert.throws(() => masterSchema.parse({ ...validMaster, experience: [] }));
});

test('masterSchema rejects an empty summary_variants object', () => {
  assert.throws(() => masterSchema.parse({ ...validMaster, summary_variants: {} }));
});

test('masterSchema rejects a role with no bullets', () => {
  const bad = { ...validMaster, experience: [{ ...validMaster.experience[0], bullets: [] }] };
  assert.throws(() => masterSchema.parse(bad));
});

test('masterSchema rejects a skill group with no items', () => {
  assert.throws(() => masterSchema.parse({ ...validMaster, skills: [{ group: 'Empty', items: [] }] }));
});

test('friendlyZodError returns a short readable line', () => {
  try {
    masterSchema.parse({ ...validMaster, experience: [] });
    assert.fail('should have thrown');
  } catch (err) {
    const msg = friendlyZodError(err);
    assert.match(msg, /experience/);
    assert.equal(typeof msg, 'string');
  }
});

test('buildParsePrompt carries the resume text and the honesty rules', () => {
  const prompt = buildParsePrompt('SENTINEL RESUME BODY');
  assert.match(prompt, /SENTINEL RESUME BODY/);
  assert.match(prompt, /NEVER invent/i);
  assert.match(prompt, /summary_variants/);
});

function mockFetch(responseObj) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'text', text: JSON.stringify(responseObj) }],
      usage: { input_tokens: 120, output_tokens: 340 },
    }),
  });
}

test('parseResumeText returns validated content + usage on a good model reply', async () => {
  const { content, usage } = await parseResumeText('some resume text', {
    fetch: mockFetch(validMaster),
  });
  assert.equal(content.contact.name, 'Rohan Antony');
  assert.equal(content.experience[0].bullets[0].tags.length, 0);
  assert.equal(usage.inputTokens, 120);
  assert.equal(usage.outputTokens, 340);
});

test('parseResumeText throws when the model reply fails the schema', async () => {
  const broken = { ...validMaster, experience: [] };
  await assert.rejects(parseResumeText('text', { fetch: mockFetch(broken) }));
});

test('PARSE_MODEL is a Sonnet-class model', () => {
  assert.match(PARSE_MODEL, /sonnet/);
});
