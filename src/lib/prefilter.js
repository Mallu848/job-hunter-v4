// Free deterministic pre-filter: kills obvious noise before jobs are stored.
// Recall-biased on purpose — anything borderline passes; M3's AI scoring does
// the fine ranking. Pure function, no I/O.

// Generic title words that don't identify a role family on their own.
const STOPWORDS = new Set([
  'engineer',
  'engineering',
  'senior',
  'sr',
  'junior',
  'jr',
  'staff',
  'lead',
  'principal',
  'associate',
  'specialist',
  'i',
  'ii',
  'iii',
  'iv',
  'v',
  'of',
  'and',
  'or',
  'the',
  'a',
  'an',
  'remote',
]);

// --- Location gate (recall-biased): explicit US markers pass, explicit
// non-US markers reject, everything ambiguous stays in. ---

const US_STATE_NAMES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
  'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa',
  'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan',
  'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire',
  'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio',
  'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota',
  'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia',
  'wisconsin', 'wyoming',
];

const US_STATE_ABBRS = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN',
  'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV',
  'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN',
  'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
];

const NON_US_NAMES = [
  'canada', 'uk', 'united kingdom', 'england', 'scotland', 'wales', 'ireland', 'germany',
  'france', 'netherlands', 'spain', 'portugal', 'poland', 'romania', 'israel', 'india',
  'singapore', 'japan', 'china', 'korea', 'australia', 'new zealand', 'brazil', 'mexico',
  'colombia', 'argentina', 'emea', 'apac', 'latam',
];

// 2-letter country codes seen on job boards. Uppercase, word-boundary,
// case-SENSITIVE so they can't match ordinary words. Note some collide with
// US state abbreviations (CA, IL, IN, DE...) — the US check runs FIRST, so
// collisions resolve in the candidate's favor (recall-biased).
const NON_US_CODES = ['PL', 'DE', 'FR', 'GB', 'AU', 'CA', 'IN', 'JP', 'SG', 'IE', 'NL', 'ES', 'PT', 'RO', 'IL', 'BR', 'MX'];

function wordRe(term, flags = '') {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-zA-Z])${escaped}($|[^a-zA-Z])`, flags);
}

function isUsLocation(location) {
  if (wordRe('united states', 'i').test(location)) return true;
  if (wordRe('usa', 'i').test(location)) return true;
  if (wordRe('us', 'i').test(location)) return true;
  for (const name of US_STATE_NAMES) {
    if (wordRe(name, 'i').test(location)) return true;
  }
  for (const abbr of US_STATE_ABBRS) {
    if (wordRe(abbr).test(location)) return true; // case-sensitive uppercase
  }
  return false;
}

function isNonUsLocation(location) {
  for (const name of NON_US_NAMES) {
    if (wordRe(name, 'i').test(location)) return true;
  }
  for (const code of NON_US_CODES) {
    if (wordRe(code).test(location)) return true; // case-sensitive uppercase
  }
  return false;
}

function tokenize(str) {
  return String(str || '')
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter(Boolean);
}

// True if `token` appears as a whole word in `text` (case-insensitive).
function hasWord(text, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9+#])${escaped}($|[^a-z0-9+#])`, 'i').test(text);
}

/**
 * @param {{title?: string, description?: string, remote?: boolean|null}} job
 * @param {{targetTitles?: string[], excludeKeywords?: string[], remoteOnly?: boolean}} profile
 * @returns {{pass: boolean, reason: string}}
 */
export function passesPrefilter(job, profile = {}) {
  const title = String(job?.title || '');
  const description = String(job?.description || '');

  // 1. Exclude keywords beat everything.
  const excludes = Array.isArray(profile.excludeKeywords) ? profile.excludeKeywords : [];
  for (const kw of excludes) {
    const needle = String(kw || '').toLowerCase().trim();
    if (!needle) continue;
    if (title.toLowerCase().includes(needle) || description.toLowerCase().includes(needle)) {
      return { pass: false, reason: `exclude keyword: ${needle}` };
    }
  }

  // 2. Remote-only: reject only when the job is explicitly NOT remote.
  if (profile.remoteOnly && job?.remote === false) {
    return { pass: false, reason: 'not remote (remote_only profile)' };
  }

  // 3. Title must share >=1 distinctive token with some target title.
  const targets = Array.isArray(profile.targetTitles) ? profile.targetTitles : [];
  let titleReason = 'no target titles configured';
  if (targets.length > 0) {
    let matched = false;
    outer: for (const target of targets) {
      const tokens = tokenize(target);
      let distinctive = tokens.filter((t) => !STOPWORDS.has(t));
      if (distinctive.length === 0) distinctive = tokens; // all-stopword target: use everything
      for (const token of distinctive) {
        if (hasWord(title, token)) {
          matched = true;
          titleReason = `title matches "${token}" from "${target}"`;
          break outer;
        }
      }
    }
    if (!matched) {
      return { pass: false, reason: 'title has no overlap with target titles' };
    }
  }

  // 4. Location gate. Explicit remote flag wins (JSearch's remote flag is
  // reliable — deliberate). Unknown/ambiguous locations stay in; explicit
  // US markers pass before non-US markers are consulted, so collisions like
  // IL (Illinois vs Israel) or CA (California vs Canada) resolve US-first.
  if (job?.remote !== true) {
    const location = String(job?.location || '').trim();
    if (location && !isUsLocation(location) && isNonUsLocation(location)) {
      return { pass: false, reason: 'non-us location' };
    }
  }

  return { pass: true, reason: titleReason };
}
