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
  if (targets.length === 0) {
    return { pass: true, reason: 'no target titles configured' };
  }

  for (const target of targets) {
    const tokens = tokenize(target);
    let distinctive = tokens.filter((t) => !STOPWORDS.has(t));
    if (distinctive.length === 0) distinctive = tokens; // all-stopword target: use everything
    for (const token of distinctive) {
      if (hasWord(title, token)) {
        return { pass: true, reason: `title matches "${token}" from "${target}"` };
      }
    }
  }

  return { pass: false, reason: 'title has no overlap with target titles' };
}
