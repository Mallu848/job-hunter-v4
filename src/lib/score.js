// AI job scoring — Haiku scores each new job 0-100 against the profile +
// master resume. Ported from v3-live's scoring approach (digest.js scoreJob,
// ai.js no-fabrication prompt style). Pure prompt/parse logic lives in
// score-core.js (DB-free, unit-tested); this module owns persistence.

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { jobs, profiles, resumes, aiUsage } from '../db/schema.js';
import { costUsd } from './pricing.js';
import { MODEL, scoreJob } from './score-core.js';

export { MODEL, buildScorePrompt, scoreJob } from './score-core.js';

const BATCH_SIZE = 4;

async function logUsage(userId, calls) {
  for (const c of calls) {
    await db.insert(aiUsage).values({
      userId,
      purpose: 'score',
      model: MODEL,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      costUsd: String(costUsd(MODEL, c.inputTokens, c.outputTokens)),
    });
  }
}

/**
 * Score all unscored triage='new' jobs for a user in batches of 4.
 * Persists score + full reasons JSON; auto-dismisses below-threshold jobs
 * (keeps the row + score for tuning). Returns { scored, dismissed, failed }.
 */
export async function runScoring(userId, deps = {}) {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!profile) return { scored: 0, dismissed: 0, failed: 0 };

  const [master] = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.kind, 'master')))
    .limit(1);
  const resumeText = master?.content?.raw_text || '';

  const pending = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.userId, userId), isNull(jobs.score), eq(jobs.triage, 'new')));

  const threshold = profile.scoreThreshold ?? 55;
  const result = { scored: 0, dismissed: 0, failed: 0 };

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (job) => {
        let parsed;
        let calls;
        try {
          ({ parsed, calls } = await scoreJob(job, profile, resumeText, deps));
        } catch (err) {
          if (Array.isArray(err.calls) && err.calls.length) await logUsage(userId, err.calls);
          throw err;
        }
        await logUsage(userId, calls);
        const dismiss = parsed.score < threshold;
        await db
          .update(jobs)
          .set({
            score: parsed.score,
            scoreReasons: parsed,
            ...(dismiss ? { triage: 'dismissed' } : {}),
          })
          .where(eq(jobs.id, job.id));
        return dismiss;
      }),
    );
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        result.scored++;
        if (s.value) result.dismissed++;
      } else {
        result.failed++;
        console.warn(`[score] job failed: ${s.reason?.message || s.reason}`);
      }
    }
  }

  console.log(
    `[score] scored=${result.scored} dismissed=${result.dismissed} failed=${result.failed}`,
  );
  return result;
}
