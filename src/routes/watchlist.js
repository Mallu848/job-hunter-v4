import { Router } from 'express';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { watchlistCompanies } from '../db/schema.js';
import { getUserId } from '../lib/seed.js';

const router = Router();

function toJson(row) {
  return {
    id: row.id,
    name: row.name,
    ats: row.ats,
    board_slug: row.boardSlug,
    active: row.active,
    created_at: row.createdAt,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const rows = await db
      .select()
      .from(watchlistCompanies)
      .where(eq(watchlistCompanies.userId, userId))
      .orderBy(desc(watchlistCompanies.createdAt));
    res.json(rows.map(toJson));
  } catch (err) {
    next(err);
  }
});

const postSchema = z
  .object({
    name: z.string().min(1),
    ats: z.enum(['greenhouse', 'lever']),
    board_slug: z.string().min(1),
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
    const slug = d.board_slug.trim().toLowerCase();

    const [existing] = await db
      .select()
      .from(watchlistCompanies)
      .where(
        and(
          eq(watchlistCompanies.userId, userId),
          eq(watchlistCompanies.ats, d.ats),
          eq(watchlistCompanies.boardSlug, slug),
        ),
      )
      .limit(1);
    if (existing) {
      return res.status(409).json({ error: 'Already on watchlist', company: toJson(existing) });
    }

    const [row] = await db
      .insert(watchlistCompanies)
      .values({ userId, name: d.name.trim(), ats: d.ats, boardSlug: slug })
      .returning();
    res.status(201).json(toJson(row));
  } catch (err) {
    next(err);
  }
});

const patchSchema = z
  .object({
    name: z.string().min(1).optional(),
    active: z.boolean().optional(),
  })
  .strict();

router.patch('/:id', async (req, res, next) => {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    }
    const d = parsed.data;
    const updates = {};
    if (d.name !== undefined) updates.name = d.name.trim();
    if (d.active !== undefined) updates.active = d.active;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const userId = await getUserId();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const [row] = await db
      .update(watchlistCompanies)
      .set(updates)
      .where(and(eq(watchlistCompanies.id, id), eq(watchlistCompanies.userId, userId)))
      .returning();
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(toJson(row));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const [row] = await db
      .delete(watchlistCompanies)
      .where(and(eq(watchlistCompanies.id, id), eq(watchlistCompanies.userId, userId)))
      .returning();
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true, id: row.id });
  } catch (err) {
    next(err);
  }
});

export default router;
