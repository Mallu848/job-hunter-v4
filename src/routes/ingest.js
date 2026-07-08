import { Router } from 'express';
import { z } from 'zod';
import { getUserId } from '../lib/seed.js';
import { runIngestion, recentRuns, isIngestionRunning } from '../lib/ingest.js';

const router = Router();

const postSchema = z
  .object({
    source: z.enum(['jsearch', 'ats']).optional(),
  })
  .strict();

function runToJson(r) {
  return {
    id: r.id,
    source: r.source,
    started_at: r.startedAt,
    finished_at: r.finishedAt,
    fetched: r.fetched,
    inserted: r.inserted,
    skipped_duplicate: r.skippedDuplicate,
    skipped_filtered: r.skippedFiltered,
    error: r.error,
  };
}

// Fire-and-poll: a full scan (sources + scoring) can outlive proxy timeouts,
// so the POST returns 202 immediately and the frontend polls /status.
// runIngestion sets its in-flight flag synchronously, so the pre-check plus
// immediate call leaves no useful race window (single-user app).
router.post('/', (req, res) => {
  const parsed = postSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
  }

  if (isIngestionRunning()) {
    return res.status(409).json({ error: 'Ingestion already running' });
  }

  runIngestion(parsed.data.source).catch((err) => {
    // Per-source errors already land in ingest_runs; this catches setup-level
    // failures (e.g. missing profile) so the promise never rejects unhandled.
    console.error('[ingest] background run failed:', err?.message || err);
  });

  res.status(202).json({ started: true });
});

router.get('/status', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const rows = await recentRuns(userId, 20);
    // Most recent run per source.
    const bySource = new Map();
    for (const r of rows) {
      if (!bySource.has(r.source)) bySource.set(r.source, r);
    }
    res.json({
      running: isIngestionRunning(),
      last_runs: [...bySource.values()].map(runToJson),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/runs', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const rows = await recentRuns(userId, limit);
    res.json(rows.map(runToJson));
  } catch (err) {
    next(err);
  }
});

export default router;
