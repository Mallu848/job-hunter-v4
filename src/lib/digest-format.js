// Pure digest formatter — DB-free so unit tests can import it directly.
// Plain text (no Telegram parse_mode) to avoid markdown-escaping bugs.

export const TOP_N = 5;

// matches: [{score, title, company, location, url, reasons: string[]}]
export function formatDigest({ matches, scannedCount, threshold, testPrefix = false }) {
  const header = testPrefix ? '[test] Job Hunter digest' : 'Job Hunter digest';

  if (!matches.length) {
    return `${header} — scanned ${scannedCount} new job${scannedCount === 1 ? '' : 's'}, none above your bar (threshold ${threshold}).`;
  }

  const sorted = [...matches].sort((a, b) => b.score - a.score).slice(0, TOP_N);
  const lines = sorted.map((m, i) => {
    const loc = m.location ? ` (${m.location})` : '';
    const why = m.reasons && m.reasons.length ? `\n   why: ${m.reasons.join('; ')}` : '';
    const url = m.url ? `\n   ${m.url}` : '';
    return `${i + 1}) ${m.score} — ${m.title} @ ${m.company}${loc}${why}${url}`;
  });

  return `${header} — ${sorted.length} new match${sorted.length === 1 ? '' : 'es'}\n\n${lines.join('\n\n')}`;
}
