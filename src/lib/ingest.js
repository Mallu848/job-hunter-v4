// Ingestion runner: pulls NormalizedJob[] from each source adapter, applies
// the deterministic pre-filter, dedupes against existing jobs, and inserts
// survivors as triage='new'. One ingest_runs row per source per run.

import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { jobs, profiles, ingestRuns } from '../db/schema.js';
import { getUserId } from './seed.js';
import { dedupeHash } from './dedupe.js';
import { passesPrefilter } from './prefilter.js';
import * as jsearch from '../sources/jsearch.js';
import * as ats from '../sources/ats.js';

const ADAPTERS = [jsearch, ats];

// Shared in-flight guard: cron and the manual API both go through
// runIngestion, so overlapping runs can never stack.
let inFlight = false;

export function isIngestionRunning() {
  return inFlight;
}

async function runSource(adapter, profile, userId) {
  const [runRow] = await db
    .insert(ingestRuns)
    .values({ userId, source: adapter.name })
    .returning();

  const counts = { fetched: 0, inserted: 0, skipped_duplicate: 0, skipped_filtered: 0 };
  let errorText = null;

  try {
    const fetched = await adapter.fetchJobs(profile);
    counts.fetched = fetched.length;

    for (const job of fetched) {
      // Duplicate by (user, source, external_id)?
      if (job.external_id) {
        const [byExternal] = await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              eq(jobs.userId, userId),
              eq(jobs.source, job.source),
              eq(jobs.externalId, job.external_id),
            ),
          )
          .limit(1);
        if (byExternal) {
          counts.skipped_duplicate++;
          continue;
        }
      }

      // Duplicate by (user, dedupe_hash)?
      const hash = dedupeHash(job.company, job.title);
      const [byHash] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.userId, userId), eq(jobs.dedupeHash, hash)))
        .limit(1);
      if (byHash) {
        counts.skipped_duplicate++;
        continue;
      }

      const verdict = passesPrefilter(job, profile);
      if (!verdict.pass) {
        counts.skipped_filtered++;
        continue;
      }

      await db.insert(jobs).values({
        userId,
        source: job.source,
        externalId: job.external_id,
        url: job.url,
        title: job.title,
        company: job.company,
        location: job.location,
        remote: job.remote,
        salaryText: job.salary_text,
        description: job.description,
        postedAt: job.posted_at,
        dedupeHash: hash,
        triage: 'new',
      });
      counts.inserted++;
    }
  } catch (err) {
    errorText = String(err?.message || err);
  }

  await db
    .update(ingestRuns)
    .set({
      finishedAt: new Date(),
      fetched: counts.fetched,
      inserted: counts.inserted,
      skippedDuplicate: counts.skipped_duplicate,
      skippedFiltered: counts.skipped_filtered,
      error: errorText,
    })
    .where(eq(ingestRuns.id, runRow.id));

  const summary = { source: adapter.name, ...counts, error: errorText };
  console.log(
    `[ingest] ${adapter.name}: fetched=${counts.fetched} inserted=${counts.inserted} ` +
      `dup=${counts.skipped_duplicate} filtered=${counts.skipped_filtered}` +
      (errorText ? ` error=${errorText}` : ''),
  );
  return summary;
}

/**
 * Run ingestion for one source (by name) or all sources.
 * Returns { busy: true } if a run is already in flight.
 */
export async function runIngestion(sourceName) {
  if (inFlight) return { busy: true, summaries: [] };
  inFlight = true;
  try {
    const userId = await getUserId();
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    if (!profile) throw new Error('no profile row — cannot ingest');
    profile.userId = userId;

    const adapters = sourceName ? ADAPTERS.filter((a) => a.name === sourceName) : ADAPTERS;
    if (adapters.length === 0) throw new Error(`unknown source: ${sourceName}`);

    const summaries = [];
    for (const adapter of adapters) {
      summaries.push(await runSource(adapter, profile, userId));
    }
    return { busy: false, summaries };
  } finally {
    inFlight = false;
  }
}

export async function recentRuns(userId, limit = 10) {
  return db
    .select()
    .from(ingestRuns)
    .where(eq(ingestRuns.userId, userId))
    .orderBy(desc(ingestRuns.startedAt))
    .limit(limit);
}
