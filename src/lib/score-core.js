// DB-free core of the scoring engine: prompt builder, Anthropic call, strict
// JSON parse with one retry. Kept separate from score.js so unit tests can
// import it without booting a database.

import { z } from 'zod';

export const MODEL = 'claude-haiku-4-5';
const RESUME_MAX = 4000;
const DESCRIPTION_MAX = 6000;

export const scoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  reasons: z.array(z.string()).max(3).default([]),
  matched_skills: z.array(z.string()).default([]),
  missing_keywords: z.array(z.string()).default([]),
  red_flags: z.array(z.string()).default([]),
});

// Pure prompt builder — exported for unit tests.
export function buildScorePrompt(job, profile, masterResumeText) {
  const titles = Array.isArray(profile.targetTitles) ? profile.targetTitles.join(', ') : '';
  const skills = Array.isArray(profile.skills) && profile.skills.length
    ? profile.skills.join(', ')
    : '(none listed — infer from resume)';
  const minSalary = profile.minSalary != null ? `$${profile.minSalary}` : 'not specified';
  const resume = String(masterResumeText || '').slice(0, RESUME_MAX);
  const description = String(job.description || '').slice(0, DESCRIPTION_MAX);

  return `You are scoring a job posting for fit against a candidate. Use ONLY the facts below — never invent skills or experience the candidate does not have.

CANDIDATE PROFILE
- Target titles: ${titles}
- Skills: ${skills}
- Minimum salary: ${minSalary}

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

Return ONLY valid JSON, no other text:
{"score": <int 0-100>, "reasons": [<up to 3 short strings>], "matched_skills": [<strings>], "missing_keywords": [<strings>], "red_flags": [<strings>]}`;
}

function extractJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON object in response');
  return JSON.parse(m[0]);
}

async function callAnthropic(prompt, fetchImpl) {
  const resp = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`anthropic ${resp.status}: ${data.error?.message || 'error'}`);
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return {
    text,
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    },
  };
}

/**
 * Score one job. DB-free (testable): returns { parsed, calls } where calls is
 * one usage entry per API call made (1 or 2 with the retry).
 * On failure, throws with err.calls set so the caller can still log usage.
 */
export async function scoreJob(job, profile, masterResumeText, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');

  const prompt = buildScorePrompt(job, profile, masterResumeText);
  const calls = [];

  try {
    const first = await callAnthropic(prompt, fetchImpl);
    calls.push(first.usage);
    try {
      return { parsed: scoreSchema.parse(extractJson(first.text)), calls };
    } catch (parseErr) {
      // One retry with a "valid JSON only" nudge, then give up (caller leaves
      // the job unscored — never crash, never lose a job).
      const nudge = `${prompt}\n\nIMPORTANT: your previous reply was not valid JSON. Return ONLY the JSON object described above — no prose, no markdown fences.`;
      const second = await callAnthropic(nudge, fetchImpl);
      calls.push(second.usage);
      return { parsed: scoreSchema.parse(extractJson(second.text)), calls };
    }
  } catch (err) {
    // Attach usage so the caller can still log ai_usage for failed attempts.
    err.calls = calls;
    throw err;
  }
}
