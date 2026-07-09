// DB-free core of the scoring engine: prompt builder, Anthropic call, strict
// JSON parse with one retry. Kept separate from score.js so unit tests can
// import it without booting a database.

import { z } from 'zod';
import { callAnthropic, extractJson } from './anthropic.js';

export const MODEL = 'claude-haiku-4-5';
const RESUME_MAX = 4000;
const DESCRIPTION_MAX = 6000;

export const scoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  reasons: z.array(z.string()).max(3).default([]),
  matched_skills: z.array(z.string()).default([]),
  missing_keywords: z.array(z.string()).default([]),
  red_flags: z.array(z.string()).default([]),
  // Posting summary fields — piggyback on the same scoring call. Defaults keep
  // responses (and old prod jobs) that lack these fields valid.
  summary: z.string().max(500).default(''),
  duties: z.array(z.string()).max(6).default([]),
  requirements: z.array(z.string()).max(8).default([]),
  salary_note: z.string().max(120).default(''),
});

// Pure prompt builder — exported for unit tests.
export function buildScorePrompt(job, profile, masterResumeText) {
  const titles = Array.isArray(profile.targetTitles) ? profile.targetTitles.join(', ') : '';
  const skills = Array.isArray(profile.skills) && profile.skills.length
    ? profile.skills.join(', ')
    : '(none listed — infer from resume)';
  const minSalary = profile.minSalary != null ? `$${profile.minSalary}` : 'not specified';
  const locations = Array.isArray(profile.locations) && profile.locations.length
    ? profile.locations.join(', ')
    : 'US-remote';
  const resume = String(masterResumeText || '').slice(0, RESUME_MAX);
  const description = String(job.description || '').slice(0, DESCRIPTION_MAX);

  return `You are scoring a job posting for fit against a candidate. Use ONLY the facts below — never invent skills or experience the candidate does not have.

CANDIDATE PROFILE
- Target titles: ${titles}
- Skills: ${skills}
- Minimum salary: ${minSalary}

CANDIDATE LOCATION CONSTRAINT
Acceptable locations: ${locations}. The candidate can ONLY work US-remote or in/near these locations.

CANDIDATE MASTER RESUME (raw text)
${resume}

JOB POSTING
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location || 'unknown'}
- Salary: ${job.salaryText || 'not listed'}
Description:
${description}

Score 0-100: required-skills match 50%, experience level 30%, industry/role fit 20%.
If the job location is incompatible with the acceptable locations (non-US and not US-remote), cap the score at 30 and add a red_flags entry naming the location mismatch.

Then, summarizing ONLY what the posting itself states (never invent details, numbers, or requirements not present in the description):
- summary: one plain sentence describing what this role actually does day to day.
- duties: 3-5 short phrases capturing the core responsibilities.
- requirements: 3-6 short phrases capturing the must-have qualifications.
- salary_note: the compensation exactly as the posting states it (e.g. "$140k-$160k/yr" or "$60/hr") if it appears ANYWHERE in the description or fields; otherwise "".

Return ONLY valid JSON, no other text:
{"score": <int 0-100>, "reasons": [<up to 3 short strings>], "matched_skills": [<strings>], "missing_keywords": [<strings>], "red_flags": [<strings>], "summary": "<string>", "duties": [<strings>], "requirements": [<strings>], "salary_note": "<string>"}`;
}

/**
 * Score one job. DB-free (testable): returns { parsed, calls } where calls is
 * one usage entry per API call made (1 or 2 with the retry).
 * On failure, throws with err.calls set so the caller can still log usage.
 */
export async function scoreJob(job, profile, masterResumeText, deps = {}) {
  const fetchImpl = deps.fetch || fetch;

  const prompt = buildScorePrompt(job, profile, masterResumeText);
  const calls = [];

  try {
    const first = await callAnthropic({ model: MODEL, prompt, maxTokens: 700, fetchImpl });
    calls.push(first.usage);
    try {
      return { parsed: scoreSchema.parse(extractJson(first.text)), calls };
    } catch (parseErr) {
      // One retry with a "valid JSON only" nudge, then give up (caller leaves
      // the job unscored — never crash, never lose a job).
      const nudge = `${prompt}\n\nIMPORTANT: your previous reply was not valid JSON. Return ONLY the JSON object described above — no prose, no markdown fences.`;
      const second = await callAnthropic({ model: MODEL, prompt: nudge, maxTokens: 700, fetchImpl });
      calls.push(second.usage);
      return { parsed: scoreSchema.parse(extractJson(second.text)), calls };
    }
  } catch (err) {
    // Attach usage so the caller can still log ai_usage for failed attempts.
    err.calls = calls;
    throw err;
  }
}
