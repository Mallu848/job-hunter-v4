import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, profiles, resumes } from '../db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');

const SEED_EMAIL = 'rohanantony848@gmail.com';

let cachedUserId = null;

// Single-user helper: resolves (and caches) the id of the one seeded user.
// All routes call this instead of dealing with auth/session concepts.
export async function getUserId() {
  if (cachedUserId) return cachedUserId;

  const existing = await db.select().from(users).where(eq(users.email, SEED_EMAIL)).limit(1);
  if (existing.length) {
    cachedUserId = existing[0].id;
    return cachedUserId;
  }

  const [row] = await db.insert(users).values({ email: SEED_EMAIL }).returning();
  cachedUserId = row.id;
  return cachedUserId;
}

let warnedMissingSeed = false;

// Returns the parsed seed-data.json, or null if the file is missing or
// unparseable (e.g. on Railway, where seed-data.json is gitignored and not
// deployed). Callers fall back to empty defaults in that case.
function readSeedData() {
  const seedPath = path.join(rootDir, 'seed-data.json');
  try {
    return JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  } catch (err) {
    if (!warnedMissingSeed) {
      console.log('seed-data.json not found — seeding empty defaults');
      warnedMissingSeed = true;
    }
    return null;
  }
}

// Idempotent boot-time seeding: creates the user (if missing), a default
// profile from seed-data.json settings (if missing), and a master resume
// from seed-data.json's resume text (if missing).
//
// IMPORTANT: seed-data.json's settings.anthropicKey / settings.rapidapiKey
// are never read, stored, or logged here.
export async function seed() {
  const userId = await getUserId();

  const [existingProfile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  if (!existingProfile) {
    const raw = readSeedData();
    const settings = (raw && raw.settings) || {};

    const targetTitles = String(settings.titles || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    await db.insert(profiles).values({
      userId,
      targetTitles,
      skills: [],
      locations: settings.location ? [settings.location] : [],
      minSalary: typeof settings.minSalary === 'number' ? settings.minSalary : null,
      remoteOnly: !!settings.remoteOnly,
      scoreThreshold: typeof settings.minScore === 'number' ? settings.minScore : 55,
      excludeKeywords: [],
    });
  }

  const [existingResume] = await db
    .select()
    .from(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.kind, 'master')))
    .limit(1);

  if (!existingResume) {
    const raw = readSeedData();
    await db.insert(resumes).values({
      userId,
      kind: 'master',
      content: { raw_text: (raw && raw.resume) || '' },
    });
  }
}
