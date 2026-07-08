import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderResume, escapeHtml } from '../src/lib/resume-render.js';

const master = {
  contact: { name: 'Rohan <Admin> & Co', location: 'Chicago, IL', email: 'r@x.test' },
  summary_variants: { a: 'Summary with "quotes" & <tags>.' },
  skills: [
    { group: 'Identity', items: [{ name: 'Entra ID', aliases: ['Azure AD'] }, { name: 'Okta', aliases: [] }] },
  ],
  experience: [
    {
      company: 'Auto Approve',
      title: 'Senior IT Analyst',
      location: 'Chicago, IL',
      start: 'Feb 2022',
      end: 'Present',
      bullets: [{ text: 'Did <script>alert(1)</script> things.', tags: [] }, { text: 'Second bullet.', tags: [] }],
    },
  ],
  education: [{ school: 'DePaul', location: 'Chicago, IL', degree: 'BS MIS', graduated: '2021' }],
  certifications: [
    { name: 'AZ-104', date: null, verified: true },
    { name: 'AZ-900', date: '11/2023', verified: true },
    { name: 'CSM', date: '2023', verified: true, note: 'expired' },
  ],
};

test('escapeHtml escapes all five characters', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('render escapes HTML in interpolated values', () => {
  const html = renderResume(master, null);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Rohan &lt;Admin&gt; &amp; Co/);
});

test('master mode renders all bullets, canonical skill names, note-free certs', () => {
  const html = renderResume(master, null);
  assert.match(html, /Second bullet\./);
  assert.match(html, /Entra ID, Okta/); // canonical names, not aliases
  assert.match(html, /AZ-104/);
  assert.match(html, /AZ-900 — 11\/2023/);
  assert.doesNotMatch(html, /CSM/); // noted cert never renders
});

test('null cert dates are omitted', () => {
  const html = renderResume(master, null);
  assert.match(html, /<div class="cert">AZ-104<\/div>/); // no dash, no date
});

test('selection mode renders chosen bullets/skills/certs only', () => {
  const selection = {
    summary_variant: 'a',
    summary_text: 'Tailored summary.',
    skills: [{ group: 'Identity', items: ['Azure AD'] }],
    experience: [
      { company: 'Auto Approve', bullets: [{ index: 1, text: 'Rephrased second bullet.' }] },
    ],
    certification_indices: [1],
    keywords_woven: [],
  };
  const html = renderResume(master, selection);
  assert.match(html, /Tailored summary\./);
  assert.match(html, /Azure AD/);
  assert.match(html, /Rephrased second bullet\./);
  assert.doesNotMatch(html, /Did &lt;script&gt;/); // unselected bullet omitted
  assert.match(html, /AZ-900/);
  assert.doesNotMatch(html, /AZ-104/); // not selected
});

test('document is standalone with print CSS and no JS', () => {
  const html = renderResume(master, null);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /@media print/);
  assert.match(html, /size: Letter/);
  assert.doesNotMatch(html, /<script/);
});
