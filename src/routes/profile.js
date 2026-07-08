import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { profiles } from '../db/schema.js';
import { getUserId } from '../lib/seed.js';

const router = Router();

function toJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.userId,
    target_titles: row.targetTitles,
    skills: row.skills,
    locations: row.locations,
    min_salary: row.minSalary,
    remote_only: row.remoteOnly,
    score_threshold: row.scoreThreshold,
    exclude_keywords: row.excludeKeywords,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    res.json(toJson(row));
  } catch (err) {
    next(err);
  }
});

const patchSchema = z
  .object({
    target_titles: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(),
    min_salary: z.number().int().nullable().optional(),
    remote_only: z.boolean().optional(),
    score_threshold: z.number().int().optional(),
    exclude_keywords: z.array(z.string()).optional(),
  })
  .strict();

router.patch('/', async (req, res, next) => {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    }

    const userId = await getUserId();
    const d = parsed.data;
    const updates = {};
    if (d.target_titles !== undefined) updates.targetTitles = d.target_titles;
    if (d.skills !== undefined) updates.skills = d.skills;
    if (d.locations !== undefined) updates.locations = d.locations;
    if (d.min_salary !== undefined) updates.minSalary = d.min_salary;
    if (d.remote_only !== undefined) updates.remoteOnly = d.remote_only;
    if (d.score_threshold !== undefined) updates.scoreThreshold = d.score_threshold;
    if (d.exclude_keywords !== undefined) updates.excludeKeywords = d.exclude_keywords;

    const [row] = await db
      .update(profiles)
      .set(updates)
      .where(eq(profiles.userId, userId))
      .returning();

    res.json(toJson(row));
  } catch (err) {
    next(err);
  }
});

export default router;
