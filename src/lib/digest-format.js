// Pure digest formatter — DB-free so unit tests can import it directly.
// Plain text (no Telegram parse_mode) to avoid markdown-escaping bugs.

export const TOP_N = 5;
export const FOLLOWUP_CAP = 10;

const STALE_MIN_DAYS = 7; // inclusive
const STALE_MAX_DAYS = 21; // exclusive

function wholeDaysBetween(then, now) {
  return Math.floor((now.getTime() - new Date(then).getTime()) / (24 * 60 * 60 * 1000));
}

function utcDateString(d) {
  // Accepts a Date or a 'YYYY-MM-DD' string (drizzle date columns).
  if (typeof d === 'string') return d.slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Pure follow-up computation. apps: [{status, applied_at, next_action,
 * next_action_date, job: {title, company}}]. Returns capped, ordered lines:
 * stale-applied first (oldest applied first), then overdue next actions
 * (earliest due first). Max FOLLOWUP_CAP lines.
 */
export function computeFollowups(apps, now = new Date()) {
  const todayUtc = now.toISOString().slice(0, 10);

  const stale = [];
  const overdue = [];

  for (const app of apps || []) {
    const title = app.job?.title || 'unknown role';
    const company = app.job?.company || 'unknown company';

    // a. STALE APPLIED: applied 7-21 whole days ago ([7, 21)).
    if (app.status === 'applied' && app.applied_at) {
      const days = wholeDaysBetween(new Date(app.applied_at), now);
      if (days >= STALE_MIN_DAYS && days < STALE_MAX_DAYS) {
        stale.push({
          sortKey: new Date(app.applied_at).getTime(),
          line: `Follow up: ${title} @ ${company} — applied ${days}d ago`,
        });
      }
    }

    // b. OVERDUE NEXT ACTION: due today or earlier (UTC date compare),
    // unless the application already ended in rejected/offer.
    if (
      app.next_action_date &&
      !['rejected', 'offer'].includes(app.status) &&
      utcDateString(app.next_action_date) <= todayUtc
    ) {
      overdue.push({
        sortKey: utcDateString(app.next_action_date),
        line: `Due: ${app.next_action || 'next action'} — ${title} @ ${company}`,
      });
    }
  }

  stale.sort((a, b) => a.sortKey - b.sortKey); // oldest applied first
  overdue.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  return [...stale, ...overdue].slice(0, FOLLOWUP_CAP).map((f) => f.line);
}

// matches: [{score, title, company, location, url, reasons: string[]}]
// followups: string[] — pre-formatted lines from computeFollowups
export function formatDigest({
  matches,
  scannedCount,
  threshold,
  testPrefix = false,
  followups = [],
}) {
  const header = testPrefix ? '[test] Job Hunter digest' : 'Job Hunter digest';

  let body;
  if (!matches.length) {
    body = `${header} — scanned ${scannedCount} new job${scannedCount === 1 ? '' : 's'}, none above your bar (threshold ${threshold}).`;
  } else {
    const sorted = [...matches].sort((a, b) => b.score - a.score).slice(0, TOP_N);
    const lines = sorted.map((m, i) => {
      const loc = m.location ? ` (${m.location})` : '';
      const pay = m.salary ? ` · ${m.salary}` : '';
      const why = m.reasons && m.reasons.length ? `\n   why: ${m.reasons.join('; ')}` : '';
      const url = m.url ? `\n   ${m.url}` : '';
      return `${i + 1}) ${m.score} — ${m.title} @ ${m.company}${loc}${pay}${why}${url}`;
    });
    body = `${header} — ${sorted.length} new match${sorted.length === 1 ? '' : 'es'}\n\n${lines.join('\n\n')}`;
  }

  // FOLLOW-UPS section only when non-empty.
  if (followups.length) {
    body += `\n\nFOLLOW-UPS\n${followups.join('\n')}`;
  }

  return body;
}
