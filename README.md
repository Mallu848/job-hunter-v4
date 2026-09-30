# Job Hunter v4

Single-user job application tracker. Milestone 1 (M1): profile, manual job entry
with dedupe, and a pipeline (kanban) for tracking applications through
saved → applied → interview → offer/rejected, with full status-change history.

## What M1 includes

- Express API (`/api/*`) backed by Drizzle ORM, dual driver:
  - `DATABASE_URL` set → Postgres via `pg` (node-postgres).
  - `DATABASE_URL` unset → PGlite, persisted at `./data/pglite`.
  - Both use the same Drizzle schema (`src/db/schema.js`, Postgres dialect).
- Idempotent boot-time seeding of a single user (from `seed-data.json`,
  `settings.anthropicKey`/`settings.rapidapiKey` are never read/stored/logged),
  a profile, and a master resume.
- Shared-secret auth (`x-app-secret` header) on all `/api` routes except
  `/api/health`.
- Static vanilla-JS frontend in `public/`: Pipeline kanban, Jobs table with
  triage + "Add Job", and a Settings tab.

## Table auto-create: PGlite vs Postgres

Both paths share one Drizzle schema (`src/db/schema.js`), but table creation
is handled differently per driver — this was the simplest reliable approach
for a single project that must support both a zero-config local dev mode
and a real Postgres deployment:

- **Postgres** (`DATABASE_URL` set): run `npm run db:push` (drizzle-kit)
  once after pointing at a fresh database, and again after any schema change.
  This is the standard drizzle-kit migration flow.
- **PGlite** (no `DATABASE_URL`): `src/db/index.js` runs
  `src/db/bootstrap.sql` — a hand-written, idempotent
  (`CREATE TABLE IF NOT EXISTS ...`) mirror of the Drizzle schema — via
  `client.exec()` on every server boot. No manual migration step needed for
  local dev. If you change `src/db/schema.js`, update `bootstrap.sql` to
  match.

## Run locally (PGlite, no setup required)

```bash
npm install
npm start
```

Server listens on `http://localhost:3000` (or `$PORT`). On first boot it will:

1. Generate an `APP_SECRET` and append it to `.env` if one isn't already set.
2. Create tables in `./data/pglite` if they don't exist.
3. Seed the single user (`SEED_EMAIL`, default `owner@example.com`), profile, and master
   resume from `seed-data.json` if they don't already exist.

Open `http://localhost:3000` — the frontend will prompt for the app secret
(check `.env` for the `APP_SECRET` value) and store it in `localStorage`.

For iterative development: `npm run dev` (auto-restarts on file changes).

## Deploy to Railway

1. Create a new Railway project from this repo, add the **Postgres** plugin.
2. Set environment variables on the service:
   - `DATABASE_URL` — copy from the Postgres plugin's connection string.
   - `APP_SECRET` — a 32-hex-char secret (or let the app generate one into
     `.env` locally and copy it — Railway env vars are separate from `.env`
     since `.env` is gitignored and not deployed).
3. Run `npm run db:push` once (locally, with `DATABASE_URL` pointed at the
   Railway Postgres instance, or via a Railway shell) to create tables.
4. Deploy. `railway.json` sets the start command to `npm start` and the
   healthcheck path to `/api/health`.

## Roadmap

- **M2** — job ingestion (RapidAPI sources), auto-dedupe against manual entries.
- **M3** — scoring against profile (target titles, salary, keywords) + digest.
- **M4** — AI-assisted resume tailoring per job (`resumes.kind = 'tailored'`).
- **M5** — polish: bulk actions, search, richer analytics.
