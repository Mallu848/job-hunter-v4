// Morning Telegram digest — top new matches from the last 24h plus follow-up
// nudges (stale applied applications + overdue next actions).
// Plain text (no parse_mode) to avoid Telegram markdown-escaping bugs.

import { eq, and, gte } from 'drizzle-orm';
import { db } from '../db/index.js';
import { jobs, profiles, applications } from '../db/schema.js';
import { formatDigest, computeFollowups, TOP_N } from './digest-format.js';

export { formatDigest, computeFollowups };

export async function buildDigest(userId, { testPrefix = false } = {}) {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const threshold = profile?.scoreThreshold ?? 55;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.userId, userId), gte(jobs.fetchedAt, since)));

  const matches = recent
    .filter((j) => j.triage === 'new' && j.score != null && j.score >= threshold)
    .map((j) => ({
      score: j.score,
      title: j.title,
      company: j.company,
      location: j.location,
      url: j.url,
      salary: j.salaryText || j.scoreReasons?.salary_note || '',
      reasons: Array.isArray(j.scoreReasons?.reasons) ? j.scoreReasons.reasons : [],
    }));

  // Follow-up nudges: all of the user's applications joined to their jobs;
  // the pure computeFollowups() picks the stale/overdue ones.
  const appRows = await db
    .select({ app: applications, job: jobs })
    .from(applications)
    .leftJoin(jobs, eq(applications.jobId, jobs.id))
    .where(eq(applications.userId, userId));

  const followups = computeFollowups(
    appRows.map(({ app, job }) => ({
      status: app.status,
      applied_at: app.appliedAt,
      next_action: app.nextAction,
      next_action_date: app.nextActionDate,
      job: job ? { title: job.title, company: job.company } : null,
    })),
  );

  return {
    text: formatDigest({ matches, scannedCount: recent.length, threshold, testPrefix, followups }),
    matches: Math.min(matches.length, TOP_N),
    scanned: recent.length,
    followups: followups.length,
  };
}

export async function sendDigest(userId, { testPrefix = false, fetchImpl = fetch } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('[digest] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — skipping send');
    return { sent: false, reason: 'telegram env not set' };
  }

  const digest = await buildDigest(userId, { testPrefix });
  const resp = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: digest.text,
      disable_web_page_preview: true,
    }),
  });
  const ok = resp.ok;
  if (!ok) console.warn(`[digest] telegram send failed: ${resp.status}`);
  return {
    sent: ok,
    status: resp.status,
    matches: digest.matches,
    scanned: digest.scanned,
    followups: digest.followups,
  };
}
