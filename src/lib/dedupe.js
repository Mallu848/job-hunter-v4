import { createHash } from 'node:crypto';

// Normalize a single field: lowercase, strip punctuation, collapse whitespace.
// Punctuation is stripped per-field (before joining) so the '|' separator
// used to combine company + title survives normalization.
function normalize(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// dedupe_hash = sha256 of lowercase(company)+'|'+lowercase(title), with
// whitespace collapsed and punctuation stripped from each field.
export function dedupeHash(company, title) {
  const combined = `${normalize(company)}|${normalize(title)}`;
  return createHash('sha256').update(combined).digest('hex');
}
