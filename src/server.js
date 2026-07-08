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

const app = express();
app.use(express.json());

const apiRouter = express.Router();
apiRouter.get('/health', (req, res) => res.json({ ok: true }));
apiRouter.use(requireAppSecret);
apiRouter.use('/profile', profileRouter);
apiRouter.use('/jobs', jobsRouter);
apiRouter.use('/applications', applicationsRouter);

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

app.listen(port, () => {
  console.log(`Job Hunter v4 listening on port ${port} (db driver: ${driver})`);
});
