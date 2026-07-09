// JSearch (RapidAPI) source adapter — ported from v3-live's netlify functions
// (digest.js searchToday / ai.js scan). One query per profile target title,
// first page only, date_posted=week. Queries run via Promise.allSettled so a
// single failed title never kills the batch.

import { formatSalary } from './salary.js';

const HOST = 'jsearch.p.rapidapi.com';
const DESCRIPTION_MAX = 10_000;

function mapJob(raw) {
  return {
    source: 'jsearch',
    external_id: raw.job_id ? String(raw.job_id) : null,
    url: raw.job_apply_link || null,
    title: raw.job_title || '',
    company: raw.employer_name || '',
    location: raw.job_is_remote
      ? 'Remote'
      : [raw.job_city, raw.job_state, raw.job_country].filter(Boolean).join(', ') || null,
    remote: typeof raw.job_is_remote === 'boolean' ? raw.job_is_remote : null,
    salary_text: formatSalary(
      raw.job_min_salary,
      raw.job_max_salary,
      raw.job_salary_period,
      raw.job_salary_currency,
    ),
    description: (raw.job_description || '').slice(0, DESCRIPTION_MAX) || null,
    posted_at: raw.job_posted_at_datetime_utc ? new Date(raw.job_posted_at_datetime_utc) : null,
  };
}

async function searchTitle(title, fetchImpl) {
  const params = new URLSearchParams({
    query: `${title} remote`,
    page: '1',
    num_pages: '1',
    date_posted: 'week',
  });
  const resp = await fetchImpl(`https://${HOST}/search?${params}`, {
    headers: {
      'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
      'X-RapidAPI-Host': HOST,
    },
  });
  if (!resp.ok) throw new Error(`jsearch ${resp.status} for "${title}"`);
  const data = await resp.json();
  return (data.data || []).map(mapJob);
}

export const name = 'jsearch';

export async function fetchJobs(profile, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  if (!process.env.RAPIDAPI_KEY) throw new Error('RAPIDAPI_KEY not set');

  const titles = Array.isArray(profile?.targetTitles) ? profile.targetTitles : [];
  if (titles.length === 0) return [];

  const results = await Promise.allSettled(titles.map((t) => searchTitle(t, fetchImpl)));

  const jobs = [];
  for (const r of results) {
    if (r.status === 'fulfilled') jobs.push(...r.value);
    else console.warn(`[jsearch] ${r.reason?.message || r.reason}`);
  }
  return jobs.filter((j) => j.title && j.company);
}
