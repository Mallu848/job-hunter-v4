import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// --- Ensure APP_SECRET exists. If missing, generate one and append it to
// .env (never rewrite the rest of the file). ---
const envPath = path.join(rootDir, '.env');
if (!process.env.APP_SECRET) {
  const secret = crypto.randomBytes(16).toString('hex'); // 32 hex chars
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const needsNewline = existing.length > 0 && !existing.endsWith('\n');
  fs.appendFileSync(envPath, `${needsNewline ? '\n' : ''}APP_SECRET=${secret}\n`);
  process.env.APP_SECRET = secret;
  console.log('No APP_SECRET found — generated a new one and appended it to .env');
}

// db/index.js and lib/seed.js read process.env.DATABASE_URL / APP_SECRET at
// import time, so they must be imported only after the block above runs.
const { db, driver } = await import('./db/index.js');
const { seed } = await import('./lib/seed.js');
const { requireAppSecret } = await import('./lib/auth.js');
const profileRouter = (await import('./routes/profile.js')).default;
const jobsRouter = (await import('./routes/jobs.js')).default;
const applicationsRouter = (await import('./routes/applications.js')).default;
const ingestRouter = (await import('./routes/ingest.js')).default;
const watchlistRouter = (await import('./routes/watchlist.js')).default;
const scoreRouter = (await import('./routes/score.js')).default;
const digestRouter = (await import('./routes/digest.js')).default;
const usageRouter = (await import('./routes/usage.js')).default;
const resumesRouter = (await import('./routes/resumes.js')).default;
const statsRouter = (await import('./routes/stats.js')).default;
const { runIngestion, isIngestionRunning } = await import('./lib/ingest.js');
const { sendDigest } = await import('./lib/digest.js');
const { getUserId } = await import('./lib/seed.js');
const cron = (await import('node-cron')).default;

const app = express();
// Behind Railway's proxy: use the real client IP (auth rate limiting).
app.set('trust proxy', 1);
// 5mb ceiling so a base64-encoded .docx resume upload (POST /api/resumes/
// master/import) fits; normal JSON bodies are tiny.
app.use(express.json({ limit: '5mb' }));

const apiRouter = express.Router();
apiRouter.get('/health', (req, res) => res.json({ ok: true }));
apiRouter.use(requireAppSecret);
apiRouter.use('/profile', profileRouter);
apiRouter.use('/jobs', jobsRouter);
apiRouter.use('/applications', applicationsRouter);
apiRouter.use('/ingest', ingestRouter);
apiRouter.use('/watchlist', watchlistRouter);
apiRouter.use('/score', scoreRouter);
apiRouter.use('/digest', digestRouter);
apiRouter.use('/usage', usageRouter);
apiRouter.use('/resumes', resumesRouter);
apiRouter.use('/stats', statsRouter);

app.use('/api', apiRouter);

app.use(express.static(path.join(rootDir, 'public')));

// 404 for unmatched /api routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Central error handler — never leak stack traces.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  res.status(status).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3000;

await seed();

// Ingestion cron — 2x/day by default (13:00 and 21:00 UTC). runIngestion has
// its own in-flight lock shared with POST /api/ingest, so runs never stack.
const cronExpr = process.env.INGEST_CRON || '0 13,21 * * *';
cron.schedule(
  cronExpr,
  async () => {
    if (isIngestionRunning()) {
      console.log('[cron] ingestion already in flight — skipping this tick');
      return;
    }
    try {
      await runIngestion();
    } catch (err) {
      console.error('[cron] ingestion failed:', err?.message || err);
    }
  },
  { timezone: 'Etc/UTC' },
);
console.log(`Ingestion cron scheduled: ${cronExpr} (UTC)`);

// Morning digest cron — 15 min after the morning scan by default. Failures
// are logged, never fatal.
const digestCronExpr = process.env.DIGEST_CRON || '15 13 * * *';
cron.schedule(
  digestCronExpr,
  async () => {
    try {
      const userId = await getUserId();
      const result = await sendDigest(userId);
      console.log(`[cron] digest: sent=${result.sent} matches=${result.matches ?? 0}`);
    } catch (err) {
      console.error('[cron] digest failed:', err?.message || err);
    }
  },
  { timezone: 'Etc/UTC' },
);
console.log(`Digest cron scheduled: ${digestCronExpr} (UTC)`);

app.listen(port, () => {
  console.log(`Job Hunter v4 listening on port ${port} (db driver: ${driver})`);
});
