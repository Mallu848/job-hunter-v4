// ATS source adapter — Greenhouse + Lever public board APIs, driven by the
// watchlist_companies table (active rows only). No API keys required.
// All company fetches run via Promise.allSettled; a failing board is logged
// and skipped, never fatal.

import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { watchlistCompanies } from '../db/schema.js';

const DESCRIPTION_MAX = 10_000;

// Minimal HTML → text: drop tags, decode the handful of entities Greenhouse
// actually emits, collapse whitespace. No innerHTML anywhere — pure string ops.
export function stripHtml(html) {
  return String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

async function fetchGreenhouse(company, fetchImpl) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company.boardSlug)}/jobs?content=true`;
  const resp = await fetchImpl(url);
  if (!resp.ok) throw new Error(`greenhouse ${resp.status} for ${company.boardSlug}`);
  const data = await resp.json();
  return (data.jobs || []).map((raw) => ({
    source: 'greenhouse',
    external_id: raw.id != null ? String(raw.id) : null,
    url: raw.absolute_url || null,
    title: raw.title || '',
    company: company.name,
    location: raw.location?.name || null,
    remote: /remote/i.test(raw.location?.name || '') ? true : null,
    salary_text: null,
    description: stripHtml(raw.content).slice(0, DESCRIPTION_MAX) || null,
    posted_at: raw.updated_at ? new Date(raw.updated_at) : null,
  }));
}

async function fetchLever(company, fetchImpl) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company.boardSlug)}?mode=json`;
  const resp = await fetchImpl(url);
  if (!resp.ok) throw new Error(`lever ${resp.status} for ${company.boardSlug}`);
  const data = await resp.json();
  if (!Array.isArray(data)) throw new Error(`lever unexpected payload for ${company.boardSlug}`);
  return data.map((raw) => ({
    source: 'lever',
    external_id: raw.id ? String(raw.id) : null,
    url: raw.hostedUrl || null,
    title: raw.text || '',
    company: company.name,
    location: raw.categories?.location || null,
    remote: /remote/i.test(raw.categories?.location || raw.workplaceType || '') ? true : null,
    salary_text: null,
    description: (raw.descriptionPlain || '').slice(0, DESCRIPTION_MAX) || null,
    posted_at: raw.createdAt ? new Date(raw.createdAt) : null,
  }));
}

export const name = 'ats';

export async function fetchJobs(profile, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const userId = profile.userId;

  const companies = await db
    .select()
    .from(watchlistCompanies)
    .where(and(eq(watchlistCompanies.userId, userId), eq(watchlistCompanies.active, true)));

  if (companies.length === 0) return [];

  const results = await Promise.allSettled(
    companies.map((c) =>
      c.ats === 'greenhouse' ? fetchGreenhouse(c, fetchImpl) : fetchLever(c, fetchImpl),
    ),
  );

  const jobs = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') jobs.push(...r.value);
    else console.warn(`[ats] ${companies[i].ats}/${companies[i].boardSlug}: ${r.reason?.message || r.reason}`);
  });
  return jobs.filter((j) => j.title && j.company);
}
