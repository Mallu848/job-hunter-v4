-- Idempotent bootstrap schema for the PGlite path.
-- Mirrors src/db/schema.js exactly. Used only when DATABASE_URL is unset.
-- For Postgres, run `npm run db:push` (drizzle-kit) instead.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  target_titles JSONB DEFAULT '[]',
  skills JSONB DEFAULT '[]',
  locations JSONB DEFAULT '[]',
  min_salary INTEGER,
  remote_only BOOLEAN DEFAULT false,
  score_threshold INTEGER DEFAULT 55,
  exclude_keywords JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS resumes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  parent_id INTEGER,
  job_id INTEGER,
  content JSONB NOT NULL,
  rendered_html TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  source TEXT DEFAULT 'manual',
  external_id TEXT,
  url TEXT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  remote BOOLEAN,
  salary_text TEXT,
  description TEXT,
  posted_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  dedupe_hash TEXT NOT NULL,
  score INTEGER,
  score_reasons JSONB,
  triage TEXT DEFAULT 'new',
  UNIQUE (user_id, dedupe_hash)
);

CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  resume_id INTEGER REFERENCES resumes(id),
  status TEXT DEFAULT 'saved',
  applied_at TIMESTAMPTZ,
  next_action TEXT,
  next_action_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS application_events (
  id SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  occurred_at TIMESTAMPTZ DEFAULT now(),
  note TEXT
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  purpose TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd NUMERIC(10,6),
  created_at TIMESTAMPTZ DEFAULT now()
);
