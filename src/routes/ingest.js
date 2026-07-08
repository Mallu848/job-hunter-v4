import { Router } from 'express';
import { z } from 'zod';
import { getUserId } from '../lib/seed.js';
import { runIngestion, recentRuns } from '../lib/ingest.js';

const router = Router();

const postSchema = z
  .object({
    source: z.enum(['jsearch', 'ats']).optional(),
  })
  .strict();

router.post('/', async (req, res, next) => {
  try {
    const parsed = postSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    }

    const result = await runIngestion(parsed.data.source);
    if (result.busy) {
      return res.status(409).json({ error: 'Ingestion already running' });
    }
    res.json({ summaries: result.summaries });
  } catch (err) {
    next(err);
  }
});

router.get('/runs', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const rows = await recentRuns(userId, limit);
    res.json(
      rows.map((r) => ({
        id: r.id,
        source: r.source,
        started_at: r.startedAt,
        finished_at: r.finishedAt,
        fetched: r.fetched,
        inserted: r.inserted,
        skipped_duplicate: r.skippedDuplicate,
        skipped_filtered: r.skippedFiltered,
        error: r.error,
      })),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
