import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  boolean,
  timestamp,
  date,
  numeric,
  unique,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const profiles = pgTable('profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  targetTitles: jsonb('target_titles').default([]),
  skills: jsonb('skills').default([]),
  locations: jsonb('locations').default([]),
  minSalary: integer('min_salary'),
  remoteOnly: boolean('remote_only').default(false),
  scoreThreshold: integer('score_threshold').default(55),
  excludeKeywords: jsonb('exclude_keywords').default([]),
});

export const resumes = pgTable('resumes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  kind: text('kind').notNull(), // 'master' | 'tailored'
  parentId: integer('parent_id'),
  jobId: integer('job_id'),
  content: jsonb('content').notNull(),
  renderedHtml: text('rendered_html'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const jobs = pgTable(
  'jobs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id),
    source: text('source').default('manual'),
    externalId: text('external_id'),
    url: text('url'),
    title: text('title').notNull(),
    company: text('company').notNull(),
    location: text('location'),
    remote: boolean('remote'),
    salaryText: text('salary_text'),
    description: text('description'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow(),
    dedupeHash: text('dedupe_hash').notNull(),
    score: integer('score'),
    scoreReasons: jsonb('score_reasons'),
    triage: text('triage').default('new'), // 'new' | 'shortlisted' | 'dismissed'
  },
  (table) => ({
    userDedupeUnique: unique('jobs_user_dedupe_unique').on(table.userId, table.dedupeHash),
  }),
);

export const applications = pgTable('applications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  jobId: integer('job_id').notNull().references(() => jobs.id),
  resumeId: integer('resume_id').references(() => resumes.id),
  status: text('status').default('saved'), // saved|applied|interview|rejected|offer
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  nextAction: text('next_action'),
  nextActionDate: date('next_action_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const applicationEvents = pgTable('application_events', {
  id: serial('id').primaryKey(),
  applicationId: integer('application_id').notNull().references(() => applications.id),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow(),
  note: text('note'),
});

export const watchlistCompanies = pgTable(
  'watchlist_companies',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    ats: text('ats').notNull(), // 'greenhouse' | 'lever'
    boardSlug: text('board_slug').notNull(),
    active: boolean('active').default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userAtsSlugUnique: unique('watchlist_user_ats_slug_unique').on(
      table.userId,
      table.ats,
      table.boardSlug,
    ),
  }),
);

export const ingestRuns = pgTable('ingest_runs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  source: text('source').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  fetched: integer('fetched').default(0),
  inserted: integer('inserted').default(0),
  skippedDuplicate: integer('skipped_duplicate').default(0),
  skippedFiltered: integer('skipped_filtered').default(0),
  error: text('error'),
});

export const aiUsage = pgTable('ai_usage', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  purpose: text('purpose'),
  model: text('model'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
