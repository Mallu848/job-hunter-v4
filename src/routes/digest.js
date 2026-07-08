import { Router } from 'express';
import { z } from 'zod';
import { getUserId } from '../lib/seed.js';
import { buildDigest, sendDigest } from '../lib/digest.js';

const router = Router();

const postSchema = z
  .object({
    dry_run: z.boolean().optional(),
    test_prefix: z.boolean().optional(),
  })
  .strict();

router.post('/', async (req, res, next) => {
  try {
    const parsed = postSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    }

    const userId = await getUserId();
    const testPrefix = !!parsed.data.test_prefix;

    if (parsed.data.dry_run) {
      const digest = await buildDigest(userId, { testPrefix });
      return res.json({ dry_run: true, ...digest });
    }

    const result = await sendDigest(userId, { testPrefix });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
