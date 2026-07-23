// DB-free core of the master resume: the zod schema that every saved master
// must satisfy (so tailoring never breaks), plus parseResumeText() — the AI
// call that turns raw resume text (extracted from an uploaded .docx) into the
// structured bullet-bank the tailoring engine reads.
//
// Honesty contract mirrors tailor-core.js: the model may only restructure what
// the resume actually states. It never invents employers, bullets, numbers,
// skills, or certifications. validateSelection() at tailor time is the second
// gate; this is the first.

import { z } from 'zod';
import { callAnthropic, extractJson } from './anthropic.js';

// Parsing a whole resume into nuanced JSON (skill groups, aliases, summary
// variants) is a quality-critical, rarely-run task — worth Sonnet, not Haiku.
export const PARSE_MODEL = 'claude-sonnet-5';
const PARSE_MAX_TOKENS = 4000;
const RESUME_TEXT_MAX = 16000;

const skillItem = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
});

const skillGroup = z.object({
  group: z.string().min(1),
  items: z.array(skillItem).min(1),
});

const bullet = z.object({
  text: z.string().min(1).max(600),
  tags: z.array(z.string()).default([]),
});

const role = z.object({
  company: z.string().min(1),
  title: z.string().default(''),
  location: z.string().default(''),
  start: z.string().default(''),
  end: z.string().default(''),
  bullets: z.array(bullet).min(1),
});

const educationEntry = z.object({
  school: z.string().min(1),
  degree: z.string().default(''),
  graduated: z.string().default(''),
  location: z.string().default(''),
});

const certification = z.object({
  name: z.string().min(1),
  date: z.string().nullable().default(null),
  verified: z.boolean().optional(),
  note: z.string().optional(),
});

// The shape a saved master must have. Minimums exist so we never persist a
// master that would make tailoring throw: at least one summary variant, at
// least one skill group with an item, and at least one role with a bullet.
export const masterSchema = z.object({
  meta: z.any().optional(),
  contact: z.object({
    name: z.string().default(''),
    email: z.string().default(''),
    location: z.string().default(''),
  }),
  summary_variants: z
    .record(z.string().min(1))
    .refine((v) => Object.keys(v).length >= 1, {
      message: 'at least one summary variant is required',
    }),
  skills: z.array(skillGroup).min(1),
  experience: z.array(role).min(1),
  education: z.array(educationEntry).default([]),
  certifications: z.array(certification).default([]),
});

// Turn a ZodError into one short, human-readable line for the toast/API.
export function friendlyZodError(err) {
  const issue = err?.issues?.[0];
  if (!issue) return 'The resume is missing required information.';
  const path = issue.path.join(' → ') || 'resume';
  return `${path}: ${issue.message}`;
}

export function buildParsePrompt(text) {
  const resume = String(text || '').slice(0, RESUME_TEXT_MAX);
  return `You convert a raw resume (plain text extracted from a .docx) into a STRUCTURED JSON "master resume" that an automated resume-tailoring system reads. Extract ONLY what the resume actually states. NEVER invent facts, numbers, employers, job titles, skills, certifications, or achievements. You may fix obvious spacing/OCR artifacts, never meaning.

Output JSON with EXACTLY this shape and keys:
{
  "contact": { "name": "", "email": "", "location": "City, ST" },
  "summary_variants": { "<snake_case_key>": "<2-4 sentence professional summary>" },
  "skills": [ { "group": "<category>", "items": [ { "name": "<canonical skill>", "aliases": ["<alternate name/acronym>"] } ] } ],
  "experience": [ { "company": "", "title": "", "location": "", "start": "Feb 2022", "end": "Present", "bullets": [ { "text": "" } ] } ],
  "education": [ { "school": "", "degree": "", "graduated": "", "location": "" } ],
  "certifications": [ { "name": "", "date": null } ]
}

RULES:
- contact: name, email, and city/state from the header. Do not include a phone number.
- summary_variants: if the resume has a summary/objective, keep it as one variant keyed by its focus (e.g. "azure_administrator"). You may add up to 2 more variants ONLY by re-emphasizing skills and experience already present for other target roles the resume clearly supports. Never introduce a new claim. At least one variant is required.
- skills: group related skills sensibly. "aliases" are well-known alternate names or acronyms for THAT SAME skill (e.g. "Microsoft Entra ID" -> ["Azure AD", "Azure Active Directory"]). Use [] when unsure. Every group needs at least one item.
- experience: every role, most-recent first, in the resume's order. Copy each bullet faithfully into its own "text". Keep numbers EXACTLY as written; never add a number that isn't there. Every role needs at least one bullet.
- education / certifications: "date"/"graduated" null or "" unless the resume states one. Never mark anything verified.

Return ONLY the JSON object — no prose, no markdown fences.

RESUME TEXT:
"""
${resume}
"""`;
}

/**
 * Parse raw resume text into a validated master-resume content object.
 * @returns {Promise<{content: object, usage: {inputTokens:number, outputTokens:number}}>}
 * @throws on API failure or if the model's output can't satisfy masterSchema.
 */
export async function parseResumeText(text, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const res = await callAnthropic({
    model: PARSE_MODEL,
    prompt: buildParsePrompt(text),
    maxTokens: PARSE_MAX_TOKENS,
    // Strict-JSON task — Sonnet 5 thinks by default and would starve the
    // output budget, returning truncated JSON.
    thinking: { type: 'disabled' },
    fetchImpl,
  });
  const content = masterSchema.parse(extractJson(res.text));
  return { content, usage: res.usage };
}
