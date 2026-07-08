import { Router } from 'express';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { jobs } from '../db/schema.js';
import { getUserId } from '../lib/seed.js';
import { dedupeHash } from '../lib/dedupe.js';

const router = Router();

const TRIAGE_VALUES = ['new', 'shortlisted', 'dismissed'];

function toJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.userId,
    source: row.source,
    external_id: row.externalId,
    url: row.url,
    title: row.title,
    company: row.company,
    location: row.location,
    remote: row.remote,
    salary_text: row.salaryText,
    description: row.description,
    posted_at: row.postedAt,
    fetched_at: row.fetchedAt,
    dedupe_hash: row.dedupeHash,
    score: row.score,
    score_reasons: row.scoreReasons,
    triage: row.triage,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const { triage } = req.query;

    let whereClause = eq(jobs.userId, userId);
    if (typeof triage === 'string' && TRIAGE_VALUES.includes(triage)) {
      whereClause = and(whereClause, eq(jobs.triage, triage));
    }

    const rows = await db.select().from(jobs).where(whereClause).orderBy(desc(jobs.fetchedAt));
    res.json(rows.map(toJson));
  } catch (err) {
    next(err);
  }
});

const postSchema = z
  .object({
    title: z.string().min(1),
    company: z.string().min(1),
    url: z.string().optional(),
    location: z.string().optional(),
    salary_text: z.string().optional(),
    remote: z.boolean().optional(),
    description: z.string().optional(),
    source: z.string().optional(),
    external_id: z.string().optional(),
    posted_at: z.string().optional(),
  })
  .strict();

router.post('/', async (req, res, next) => {
  try {
    const parsed = postSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    }

    const userId = await getUserId();
    const d = parsed.data;
    const hash = dedupeHash(d.company, d.title);

    const [existing] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, userId), eq(jobs.dedupeHash, hash)))
      .limit(1);

    if (existing) {
      return res.status(409).json({ error: 'Duplicate job', job: toJson(existing) });
    }

    const [row] = await db
      .insert(jobs)
      .values({
        userId,
        title: d.title,
        company: d.company,
        url: d.url,
        location: d.location,
        salaryText: d.salary_text,
        remote: d.remote,
        description: d.description,
        source: d.source ?? 'manual',
        externalId: d.external_id,
        postedAt: d.posted_at ? new Date(d.posted_at) : null,
        dedupeHash: hash,
      })
      .returning();

    res.status(201).json(toJson(row));
  } catch (err) {
    next(err);
  }
});

const patchSchema = z
  .object({
    title: z.string().min(1).optional(),
    company: z.string().min(1).optional(),
    url: z.string().optional(),
    location: z.string().optional(),
    salary_text: z.string().optional(),
    remote: z.boolean().optional(),
    description: z.string().optional(),
    triage: z.enum(TRIAGE_VALUES).optional(),
    score: z.number().int().optional(),
    score_reasons: z.any().optional(),
  })
  .strict();

router.patch('/:id', async (req, res, next) => {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    }

    const userId = await getUserId();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const d = parsed.data;
    const updates = {};
    if (d.title !== undefined) updates.title = d.title;
    if (d.company !== undefined) updates.company = d.company;
    if (d.url !== undefined) updates.url = d.url;
    if (d.location !== undefined) updates.location = d.location;
    if (d.salary_text !== undefined) updates.salaryText = d.salary_text;
    if (d.remote !== undefined) updates.remote = d.remote;
    if (d.description !== undefined) updates.description = d.description;
    if (d.triage !== undefined) updates.triage = d.triage;
    if (d.score !== undefined) updates.score = d.score;
    if (d.score_reasons !== undefined) updates.scoreReasons = d.score_reasons;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Recompute dedupe_hash if title or company changed.
    if (updates.title !== undefined || updates.company !== undefined) {
      const [current] = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, id), eq(jobs.userId, userId)))
        .limit(1);
      if (!current) return res.status(404).json({ error: 'Not found' });
      const newTitle = updates.title ?? current.title;
      const newCompany = updates.company ?? current.company;
      updates.dedupeHash = dedupeHash(newCompany, newTitle);
    }

    const [row] = await db
      .update(jobs)
      .set(updates)
      .where(and(eq(jobs.id, id), eq(jobs.userId, userId)))
      .returning();

    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(toJson(row));
  } catch (err) {
    next(err);
  }
});

export default router;
