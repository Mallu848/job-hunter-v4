# Job Hunter v4 — Master Plan

**v4 = Railway rebuild of Job Hunter.** v3 (`../v3-live`, Netlify + localStorage) stays live and untouched until v4 reaches feature parity. `../v3-live - Copy` is a backup from 2026-07-08. v1/v2 are archives.

Why v4 exists: v3's localStorage architecture can't support Phase 2 (multi-user) or Phase 3 (billing). v4 moves data to Postgres with `user_id` on every table from day one.

## Stack (decided, don't relitigate)
- Node ES modules + Express, Drizzle ORM. One Railway service — cron runs in-process (node-cron), no separate worker.
- DB: Railway Postgres in prod (`DATABASE_URL`), PGlite at `./data/pglite` locally. Same schema, driver picked in `src/db/index.js`.
- Frontend: vanilla JS in `public/` — createElement + textContent + addEventListener only, NEVER innerHTML with data. No frameworks, no CDNs.
- Auth (Phase 1): `x-app-secret` header vs `APP_SECRET` env. Real auth is Phase 2.
- AI: Haiku 4.5 for job scoring (volume), Sonnet-class for resume tailoring (quality affects interview rate). Log every call to `ai_usage` (this table is the Phase 3 billing meter).
- Schema: users, profiles, resumes (master/tailored, parent_id, job_id), jobs (dedupe_hash UNIQUE per user, triage new/shortlisted/dismissed), applications (status saved/applied/interview/rejected/offer), application_events (full status history), ai_usage. See `src/db/schema.js`.

## Job sourcing strategy (decided)
- **NEVER scrape LinkedIn or Indeed** — ToS + account-ban risk mid job hunt. Hard no.
- **NEVER auto-apply.** Human clicks submit, always.
- Backbone: ATS public JSON APIs — Greenhouse `boards-api.greenhouse.io/v1/boards/{co}/jobs`, Lever `api.lever.co/v0/postings/{co}`, plus Ashby/Workable later. Company watchlist (~20 to start) in a config table.
- Breadth: JSearch on RapidAPI (key already in `.env`) — aggregates Google-for-Jobs incl. LinkedIn/Indeed postings legitimately. v3's netlify function has a working JSearch integration to port.
- Extras later: Adzuna, Remotive/RemoteOK APIs. Dice = manual only (no public API).
- All sources behind one `JobSource` interface: `fetch(criteria) -> NormalizedJob[]`. Cron 2×/day. Dedupe by sha256(company|title) normalized — `src/lib/dedupe.js`.

## Scoring (M3)
Two-stage: (1) free deterministic pre-filter — title regex vs target_titles, exclude_keywords, salary floor; (2) Haiku scores survivors 0–100 with reasons vs profile. `score_threshold` (currently 55) gates the dashboard. No embeddings/vector DB — overkill at this volume.

## Resume tailoring (M4)
- Master resume = structured JSON in resumes.content: summary_variants (2–3 flavors), skills with ATS aliases (e.g. "Entra ID"/"Azure AD"), experience[] each with a bullet BANK (8–12 tagged bullets, more than any resume shows), certs, education.
- HOMEWORK FOR ROHAN: current master is a garbled PDF extraction with stale certs (missing AZ-104, AI-900, Net+, Sec+). Needs a rewrite into the bullet-bank JSON before M4 is useful.
- LLM does selection + emphasis ONLY — picks bullets, reorders skills, picks summary variant. Hard rule in prompt: never invent facts. Output = structured JSON, zod-validated, low temperature.
- Render: JSON → fixed HTML template with print CSS → Ctrl+P to PDF. No server-side PDF generation (no Puppeteer).
- Dashboard shows tailored-vs-master diff before use. Tailored resume row links job_id; application links resume_id.
- v3 has battle-tested no-fabrication prompts — port them.

## Milestones
- **M1 — DONE (2026-07-08).** Tracker core: schema, secret auth, jobs/applications CRUD + status events, kanban dashboard, seeding. Reviewed + Playwright-tested. Commits b2e175c, 3a830f8.
- **M1.5 — DONE (2026-07-08).** Live at <your-railway-url>; runbook in deploy-and-verify skill registry.
- **M2 — DONE (2026-07-08), live in prod.** JSearch + Greenhouse/Lever adapters, pre-filter (9 unit tests), dual dedupe, cron 13:00/21:00 UTC, Scan now + watchlist UI. First prod scan: 9 jobs. Schema-change lesson: use additive SQL scripts against prod, not drizzle-kit push (see deploy-and-verify skill).
- **M3 — DONE (2026-07-08), live in prod.** Haiku scoring w/ reasons + auto-dismiss below threshold, ai_usage cost logging, digest cron 13:15 UTC, exclude-keywords UI, usage line. Live-fire: 27 prod jobs scored, 3 above bar, digest delivered (status 200). OPEN MYSTERY: Rohan added watchlist companies but prod watchlist_companies is empty — investigating where they went.
- **M4 — Resume tailoring.** Bullet-bank master (after Rohan rewrites it), Sonnet tailor endpoint, HTML render, diff view, link to application.
- **M5 — Polish.** Follow-up nudges (applied >7d stale → Telegram), funnel stats (applied→interview rate per resume variant).
- Deferred past Phase 1: cover letters, email parsing, more sources, real auth (P2), Stripe (P3).

## Delegation (per global CLAUDE.md)
Fable 5 plans/reviews; Sonnet 5 implements against specs; browser testing + bulk reading go to the cheap model. Every implementation round gets a review pass before acceptance.

## Secrets
`seed-data.json` contains live API keys — gitignored, NEVER commit, never copy keys into the DB. Prod seeding: file absent → empty defaults; profile + resume then restored via API. `.env` holds ANTHROPIC_API_KEY, RAPIDAPI_KEY, APP_SECRET (dev). Production APP_SECRET must be fresh, not the dev one.
