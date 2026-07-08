import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSelection, tailorResume } from '../src/lib/tailor-core.js';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';

const master = {
  contact: { name: 'Rohan A', location: 'Chicago, IL', email: 'r@x.test' },
  summary_variants: {
    azure_administrator: 'Azure-focused IT analyst.',
    cloud_support_engineer: 'Cloud support specialist.',
  },
  skills: [
    {
      group: 'Identity & Access',
      items: [
        { name: 'Microsoft Entra ID', aliases: ['Azure Active Directory', 'Azure AD'] },
        { name: 'Okta', aliases: [] },
      ],
    },
    { group: 'Scripting & Data', items: [{ name: 'PowerShell', aliases: [] }] },
  ],
  experience: [
    {
      company: 'Auto Approve',
      title: 'Senior IT Analyst',
      location: 'Chicago, IL',
      start: 'Feb 2022',
      end: 'Present',
      bullets: [
        { text: 'Managed Entra ID for 300 users.', tags: [] },
        { text: 'Automated onboarding with PowerShell.', tags: [] },
        { text: 'Ran the help desk.', tags: [] },
      ],
    },
    {
      company: 'AMITA Health',
      title: 'Systems Engineer',
      location: 'Chicago, IL',
      start: '2020',
      end: '2022',
      bullets: [{ text: 'Supported clinical systems.', tags: [] }],
    },
  ],
  education: [{ school: 'DePaul', location: 'Chicago', degree: 'BS MIS', graduated: '2021' }],
  certifications: [
    { name: 'AZ-104', date: null, verified: true },
    { name: 'AZ-900', date: '11/2023', verified: true },
    { name: 'CSM', date: '04/2023', verified: true, note: 'expired — confirm renewal' },
  ],
};

function validSelection(overrides = {}) {
  return {
    summary_variant: 'azure_administrator',
    summary_text: 'Azure-focused IT analyst.',
    skills: [{ group: 'Identity & Access', items: ['Azure Active Directory', 'Okta'] }],
    experience: [
      {
        company: 'Auto Approve',
        bullets: [
          { index: 0, text: 'Managed Entra ID for 300 users.' },
          { index: 1, text: 'Automated onboarding with PowerShell.' },
        ],
      },
      { company: 'AMITA Health', bullets: [{ index: 0, text: 'Supported clinical systems.' }] },
    ],
    certification_indices: [0, 1],
    keywords_woven: ['Azure AD'],
    ...overrides,
  };
}

test('validateSelection accepts a valid selection including alias-form skills', () => {
  const out = validateSelection(master, validSelection());
  assert.deepEqual(out.certification_indices, [0, 1]);
});

test('validateSelection rejects an invented skill', () => {
  assert.throws(
    () => validateSelection(master, validSelection({
      skills: [{ group: 'Identity & Access', items: ['Kubernetes'] }],
    })),
    /"Kubernetes" is not a name or alias/,
  );
});

test('validateSelection rejects an out-of-range bullet index', () => {
  const sel = validSelection();
  sel.experience[0].bullets.push({ index: 9, text: 'Whatever.' });
  assert.throws(() => validateSelection(master, sel), /bullet index 9 out of range/);
});

test('validateSelection rejects companies out of master order', () => {
  const sel = validSelection();
  sel.experience.reverse();
  assert.throws(() => validateSelection(master, sel), /master order/);
});

test('validateSelection rejects a foreign summary variant', () => {
  assert.throws(
    () => validateSelection(master, validSelection({ summary_variant: 'startup_founder' })),
    /not a key of summary_variants/,
  );
});

test('validateSelection silently drops noted certs', () => {
  const out = validateSelection(master, validSelection({ certification_indices: [0, 2] }));
  assert.deepEqual(out.certification_indices, [0]); // CSM (index 2, noted) dropped
});

const job = { title: 'Azure Administrator', company: 'Contoso', description: 'Azure AD admin.' };

function fakeResponse(obj, usage = { input_tokens: 500, output_tokens: 200 }) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return { ok: true, json: async () => ({ content: [{ type: 'text', text }], usage }) };
}

test('tailorResume succeeds on valid JSON first try', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return fakeResponse(validSelection());
  };
  const { selection, calls: usage } = await tailorResume(job, master, {}, { fetch: fakeFetch });
  assert.equal(selection.summary_variant, 'azure_administrator');
  assert.equal(calls, 1);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].inputTokens, 500);
});

test('tailorResume retries with validation feedback and succeeds', async () => {
  let calls = 0;
  const fakeFetch = async (url, opts) => {
    calls++;
    if (calls === 1) {
      return fakeResponse(validSelection({
        skills: [{ group: 'Identity & Access', items: ['Kubernetes'] }],
      }));
    }
    // The retry prompt must carry the specific validation error back.
    assert.match(JSON.parse(opts.body).messages[0].content, /Kubernetes/);
    return fakeResponse(validSelection());
  };
  const { selection, calls: usage } = await tailorResume(job, master, {}, { fetch: fakeFetch });
  assert.equal(calls, 2);
  assert.equal(usage.length, 2);
  assert.equal(selection.skills[0].items[0], 'Azure Active Directory');
});

test('tailorResume throws after two failures with usage attached', async () => {
  const fakeFetch = async () => fakeResponse('not even json');
  await assert.rejects(
    () => tailorResume(job, master, {}, { fetch: fakeFetch }),
    (err) => {
      assert.equal(err.calls.length, 2);
      return true;
    },
  );
});
