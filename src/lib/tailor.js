// Resume tailoring persistence wrapper — mirrors score.js's structure:
// tailor-core.js does the AI work (DB-free), this module loads inputs,
// persists the tailored resume row, and meters ai_usage.

import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { jobs, resumes, aiUsage } from '../db/schema.js';
import { costUsd } from './pricing.js';
import { TAILOR_MODEL, tailorResume } from './tailor-core.js';
import { renderResume } from './resume-render.js';

async function logUsage(userId, calls) {
  for (const c of calls) {
    await db.insert(aiUsage).values({
      userId,
      purpose: 'tailor',
      model: TAILOR_MODEL,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      costUsd: String(costUsd(TAILOR_MODEL, c.inputTokens, c.outputTokens)),
    });
  }
}

/**
 * Tailor the master resume for one job and persist the result.
 * Returns { resume_id, summary_variant, bullet_count, keywords_woven }.
 * Throws { status } errors for route-level 404/400 handling.
 */
export async function runTailor(userId, jobId, deps = {}) {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.userId, userId)))
    .limit(1);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }

  const [master] = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.kind, 'master')))
    .limit(1);
  if (!master || !master.content || !Array.isArray(master.content.experience)) {
    const err = new Error('No structured master resume found');
    err.status = 400;
    throw err;
  }

  let selection;
  let calls;
  try {
    ({ selection, calls } = await tailorResume(
      { title: job.title, company: job.company, description: job.description },
      master.content,
      job.scoreReasons || {},
      deps,
    ));
  } catch (err) {
    if (Array.isArray(err.calls) && err.calls.length) await logUsage(userId, err.calls);
    throw err;
  }
  await logUsage(userId, calls);

  const [row] = await db
    .insert(resumes)
    .values({
      userId,
      kind: 'tailored',
      parentId: master.id,
      jobId: job.id,
      // Snapshot the master so later master edits can't corrupt old diffs.
      content: { selection, master_snapshot: master.content },
      renderedHtml: renderResume(master.content, selection),
    })
    .returning();

  return {
    resume_id: row.id,
    summary_variant: selection.summary_variant,
    roles: selection.experience.length,
    bullet_count: selection.experience.reduce((n, r) => n + r.bullets.length, 0),
    keywords_woven: selection.keywords_woven,
  };
}
