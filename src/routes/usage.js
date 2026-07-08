import { Router } from 'express';
import { eq, and, gte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { aiUsage } from '../db/schema.js';
import { getUserId } from '../lib/seed.js';

const router = Router();

// AI usage for the current calendar month: call count + summed cost.
router.get('/', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const rows = await db
      .select({ costUsd: aiUsage.costUsd })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, monthStart)));

    const cost = rows.reduce((sum, r) => sum + Number(r.costUsd || 0), 0);
    res.json({ month: monthStart.toISOString().slice(0, 7), calls: rows.length, cost_usd: Number(cost.toFixed(4)) });
  } catch (err) {
    next(err);
  }
});

export default router;
