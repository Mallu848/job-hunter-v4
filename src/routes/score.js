import { Router } from 'express';
import { getUserId } from '../lib/seed.js';
import { runScoring } from '../lib/score.js';

const router = Router();

router.post('/run', async (req, res, next) => {
  try {
    const userId = await getUserId();
    const result = await runScoring(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
