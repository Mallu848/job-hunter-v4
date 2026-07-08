// Funnel stats: current pipeline counts + "ever reached" funnel from
// application_events + per-resume-variant conversion. The event-folding
// logic is a pure function (rows in → stats out) so tests need no DB.

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { applications, applicationEvents, resumes } from '../db/schema.js';
import { getUserId } from './seed.js';

const STATUSES = ['saved', 'applied', 'interview', 'rejected', 'offer'];

function rate(numerator, denominator) {
  if (!denominator) return null; // never divide by zero, never NaN in JSON
  return Number((numerator / denominator).toFixed(3));
}

/**
 * Pure stats folding.
 * @param {Array<{id:number,status:string,resume_id:number|null}>} apps
 * @param {Array<{application_id:number,to_status:string}>} events
 * @param {Map<number,string>|Record<number,string>} variantByResumeId tailored
 *        resume id → summary_variant
 */
export function foldStats(apps, events, variantByResumeId = new Map()) {
  const variantOf =
    variantByResumeId instanceof Map
      ? (id) => variantByResumeId.get(id)
      : (id) => variantByResumeId[id];

  // Current pipeline counts, zero-filled for all five statuses.
  const pipeline = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const app of apps) {
    if (pipeline[app.status] !== undefined) pipeline[app.status]++;
  }

  // Ever-reached per app: statuses from its events PLUS its current status
  // (covers apps created directly into a status with no event row), deduped.
  const reachedByApp = new Map();
  for (const app of apps) {
    reachedByApp.set(app.id, new Set([app.status]));
  }
  for (const ev of events) {
    const set = reachedByApp.get(ev.application_id);
    if (set) set.add(ev.to_status);
  }

  const everCount = (status) => {
    let n = 0;
    for (const set of reachedByApp.values()) if (set.has(status)) n++;
    return n;
  };

  const everApplied = everCount('applied');
  const everInterview = everCount('interview');
  const everOffer = everCount('offer');
  const everRejected = everCount('rejected');

  // Per-variant breakdown. Apps without a resume_id (or whose resume has no
  // variant) group under "untailored".
  const groups = new Map();
  for (const app of apps) {
    const variant = (app.resume_id != null && variantOf(app.resume_id)) || 'untailored';
    if (!groups.has(variant)) groups.set(variant, { applied: 0, interview: 0 });
    const g = groups.get(variant);
    const reached = reachedByApp.get(app.id);
    if (reached.has('applied')) g.applied++;
    if (reached.has('interview')) g.interview++;
  }

  const byVariant = [...groups.entries()].map(([variant, g]) => ({
    variant,
    ever_applied: g.applied,
    ever_interview: g.interview,
    applied_to_interview: rate(g.interview, g.applied),
  }));

  return {
    pipeline,
    funnel: {
      ever_applied: everApplied,
      ever_interview: everInterview,
      ever_offer: everOffer,
      ever_rejected: everRejected,
      applied_to_interview: rate(everInterview, everApplied),
      interview_to_offer: rate(everOffer, everInterview),
    },
    by_variant: byVariant,
  };
}

export async function getStats() {
  const userId = await getUserId();

  const appRows = await db
    .select({ id: applications.id, status: applications.status, resumeId: applications.resumeId })
    .from(applications)
    .where(eq(applications.userId, userId));

  const apps = appRows.map((a) => ({ id: a.id, status: a.status, resume_id: a.resumeId }));

  // Events for this user's applications only.
  const eventRows = await db
    .select({
      application_id: applicationEvents.applicationId,
      to_status: applicationEvents.toStatus,
    })
    .from(applicationEvents)
    .innerJoin(applications, eq(applicationEvents.applicationId, applications.id))
    .where(eq(applications.userId, userId));

  // Variant lookup for the linked tailored resumes.
  const resumeRows = await db
    .select({ id: resumes.id, content: resumes.content })
    .from(resumes)
    .where(eq(resumes.userId, userId));
  const variantByResumeId = new Map();
  for (const r of resumeRows) {
    const variant = r.content?.selection?.summary_variant;
    if (variant) variantByResumeId.set(r.id, variant);
  }

  return foldStats(apps, eventRows, variantByResumeId);
}
