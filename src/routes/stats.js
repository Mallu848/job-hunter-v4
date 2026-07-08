import { Router } from 'express';
import { getStats } from '../lib/stats.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await getStats());
  } catch (err) {
    next(err);
  }
});

export default router;
