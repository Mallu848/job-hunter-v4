// Shared salary formatter — one implementation for both the JSearch and Lever
// adapters. Produces a compact human string like "$140K–$160K/yr" or "$60/hr".

/**
 * @param {number|null|undefined} min
 * @param {number|null|undefined} max
 * @param {string} period JSearch job_salary_period ('YEAR'|'HOUR'|...) or a
 *   Lever interval ('per-year-salary'|'per-hour-wage'); hourly if it matches /hour/i
 * @param {string} currency 'USD'/falsy => '$', else `${currency} ` prefix
 * @returns {string|null}
 */
export function formatSalary(min, max, period, currency) {
  if (!min && !max) return null;

  const cur = !currency || currency === 'USD' ? '$' : `${currency} `;
  const hourly = /hour/i.test(String(period || ''));
  const unit = hourly ? '/hr' : '/yr';
  const fmt = (n) => (hourly ? `${cur}${Math.round(n)}` : `${cur}${Math.round(n / 1000)}K`);

  if (min && max) return `${fmt(min)}–${fmt(max)}${unit}`;
  if (min) return `${fmt(min)}+${unit}`;
  return `up to ${fmt(max)}${unit}`;
}
