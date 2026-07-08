// DB-free core of resume tailoring: prompt builder, Sonnet call, strict JSON
// parse, and — the part that actually enforces honesty — validateSelection(),
// which cross-checks every LLM choice against the master resume. The model
// SELECTS and REPHRASES; it cannot introduce a bullet, skill, cert, or role
// that isn't in the master. Kept separate from tailor.js (persistence) so unit
// tests run without a database.

import { z } from 'zod';
import { callAnthropic, extractJson } from './anthropic.js';

export const TAILOR_MODEL = 'claude-sonnet-5';
const DESCRIPTION_MAX = 6000;
const MAX_TOKENS = 2000;

// What the LLM returns: selections by key/index, with optional rephrased text.
export const tailorSchema = z.object({
  summary_variant: z.string(),
  summary_text: z.string().min(1).max(700),
  skills: z
    .array(
      z.object({
        group: z.string(),
        items: z.array(z.string()).min(1),
      }),
    )
    .min(1),
  experience: z
    .array(
      z.object({
        company: z.string(),
        bullets: z
          .array(z.object({ index: z.number().int().min(0), text: z.string().min(1).max(400) }))
          .min(1),
      }),
    )
    .min(1),
  certification_indices: z.array(z.number().int().min(0)),
  keywords_woven: z.array(z.string()).default([]),
});

// What the model sees: the master minus noise that hurts selection quality.
// raw_text duplicates everything (wasted tokens), meta is editor notes, and
// the verified flag made the model too shy to list certs Rohan holds — cert
// safety lives in the note field (rule 7) + validateSelection, not here.
export function promptView(master) {
  return {
    contact: master.contact,
    summary_variants: master.summary_variants,
    skills: master.skills,
    experience: master.experience,
    education: master.education,
    certifications: (master.certifications || []).map((c) => ({
      name: c.name,
      date: c.date,
      ...(c.note ? { note: c.note } : {}),
    })),
  };
}

export function buildTailorPrompt(master, job, scoreReasons = {}) {
  const description = String(job.description || '').slice(0, DESCRIPTION_MAX);
  const matched = Array.isArray(scoreReasons.matched_skills) ? scoreReasons.matched_skills : [];
  const missing = Array.isArray(scoreReasons.missing_keywords) ? scoreReasons.missing_keywords : [];

  return `You are tailoring a resume for a specific job posting. You SELECT and lightly REPHRASE from the master resume below. You never write new facts.

MASTER RESUME (structured JSON — the only source of truth):
${JSON.stringify(promptView(master), null, 1)}

TARGET JOB
- Title: ${job.title}
- Company: ${job.company}
Description:
${description}

ATS SIGNALS FROM SCORING
- Skills already matched: ${matched.join(', ') || '(none)'}
- Keywords the posting wants that may be under-surfaced: ${missing.join(', ') || '(none)'}

STRICT RULES — violating any of these is disqualifying:
1. NEVER add experience, skills, certifications, tools, numbers, or achievements that are not in the master resume. Rephrasing may reorder, trim, or emphasize — never extend scope.
2. Skill items must be the master's canonical name OR one of its listed aliases (use the alias form the job posting uses, e.g. "Azure Active Directory" when the posting says that instead of "Microsoft Entra ID"). Nothing else.
3. summary_variant must be one of the summary_variants keys. summary_text starts from that variant; you may only trim it or swap in alias wording already present in the skills list. No new claims.
4. Select bullets by their 0-based index within each company's bullet list. Rephrased text must preserve every fact in the original bullet. If the original has a number, keep the number exactly; if it has none, do not add one.
5. Lead bullets with strong action verbs (Automated, Deployed, Reduced, Built, Streamlined, Implemented).
6. Keep every company from the master in the same order. Most recent role: 4-5 bullets. Older roles: 2-3 bullets. Total must fit one page.
7. certification_indices are 0-based indices into the master certifications array. Include EVERY certification, ordered most-relevant-to-this-job first — certifications are hard-earned credentials and are never dropped. The one exception: NEVER select a certification whose entry has a "note" field. Never state a date for a certification whose date is null.
8. keywords_woven = the posting keywords you honestly surfaced (for the human reviewer's audit). Do not list a keyword you could not honestly work in.

Return ONLY valid JSON, no other text:
{"summary_variant": "<key>", "summary_text": "<string>", "skills": [{"group": "<group name>", "items": ["<skill or alias>"]}], "experience": [{"company": "<company>", "bullets": [{"index": <int>, "text": "<final bullet text>"}]}], "certification_indices": [<ints>], "keywords_woven": ["<strings>"]}`;
}

// Cross-check every selection against the master. Throws with a specific
// message (fed back to the model on retry). Returns a cleaned selection.
export function validateSelection(master, sel) {
  const errors = [];

  if (!master.summary_variants?.[sel.summary_variant]) {
    errors.push(`summary_variant "${sel.summary_variant}" is not a key of summary_variants`);
  }

  // Build the set of legal skill strings: canonical names + aliases, per group.
  const groupByName = new Map();
  const legalByGroup = new Map();
  for (const g of master.skills || []) {
    const legal = new Set();
    for (const item of g.items || []) {
      legal.add(item.name.toLowerCase());
      for (const a of item.aliases || []) legal.add(a.toLowerCase());
    }
    groupByName.set(g.group.toLowerCase(), g.group);
    legalByGroup.set(g.group.toLowerCase(), legal);
  }
  for (const g of sel.skills) {
    const legal = legalByGroup.get(g.group.toLowerCase());
    if (!legal) {
      errors.push(`skills group "${g.group}" is not in the master resume`);
      continue;
    }
    for (const item of g.items) {
      if (!legal.has(item.toLowerCase())) {
        errors.push(`skill "${item}" is not a name or alias in master group "${g.group}"`);
      }
    }
  }

  // Experience: companies must exist, keep master order, indices in range.
  const masterCompanies = (master.experience || []).map((r) => r.company);
  const selCompanies = sel.experience.map((r) => r.company);
  const orderCheck = masterCompanies.filter((c) => selCompanies.includes(c));
  if (JSON.stringify(orderCheck) !== JSON.stringify(selCompanies)) {
    errors.push(
      `experience companies must be a subset of the master in master order (${masterCompanies.join(' > ')})`,
    );
  }
  for (const role of sel.experience) {
    const masterRole = (master.experience || []).find((r) => r.company === role.company);
    if (!masterRole) continue; // already reported by the order check
    for (const b of role.bullets) {
      if (b.index >= masterRole.bullets.length) {
        errors.push(`bullet index ${b.index} out of range for ${role.company}`);
      }
    }
  }

  // Certifications: in range; silently drop any with a note (belt & braces —
  // the prompt forbids them, but the human gate should never see one slip in).
  const certs = master.certifications || [];
  const certIndices = [];
  for (const i of sel.certification_indices) {
    if (i >= certs.length) errors.push(`certification index ${i} out of range`);
    else if (!certs[i].note) certIndices.push(i);
  }

  if (errors.length) {
    const err = new Error(`selection failed validation: ${errors.join('; ')}`);
    err.validationErrors = errors;
    throw err;
  }
  return { ...sel, certification_indices: certIndices };
}

/**
 * Tailor a resume for one job. Returns { selection, calls } where calls is one
 * usage entry per API call (1 or 2 with the retry). On failure, throws with
 * err.calls set so the caller can still log ai_usage.
 */
export async function tailorResume(job, master, scoreReasons, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const prompt = buildTailorPrompt(master, job, scoreReasons);
  const calls = [];

  const attempt = async (p) => {
    const res = await callAnthropic({
      model: TAILOR_MODEL,
      prompt: p,
      maxTokens: MAX_TOKENS,
      // Sonnet 5 thinks by default; a strict-JSON selection task doesn't
      // need it, and an unbounded thinking block starves the text budget.
      thinking: { type: 'disabled' },
      fetchImpl,
    });
    calls.push(res.usage);
    return validateSelection(master, tailorSchema.parse(extractJson(res.text)));
  };

  try {
    try {
      return { selection: await attempt(prompt), calls };
    } catch (firstErr) {
      // One retry, telling the model exactly what was wrong.
      const nudge = `${prompt}\n\nIMPORTANT: your previous reply was rejected: ${firstErr.message}. Fix these problems and return ONLY the JSON object described above — no prose, no markdown fences.`;
      return { selection: await attempt(nudge), calls };
    }
  } catch (err) {
    err.calls = calls;
    throw err;
  }
}
