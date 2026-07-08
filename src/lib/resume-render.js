// Pure, DB-free resume renderer: (master, selection) → standalone printable
// HTML document string. selection is a validated tailor-core output; pass
// selection=null to render the FULL master (all bullets, canonical skill
// names, all note-free certs).
//
// SECURITY: this HTML is assembled server-side by string templating from
// validated data — every interpolated value goes through escapeHtml. No
// user-supplied HTML is ever passed through, and the document contains no JS.

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const e = escapeHtml;

const STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: 11px; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111;
    background: #fff;
    max-width: 8.5in;
    margin: 0 auto;
    padding: 0.6in;
    line-height: 1.35;
  }
  header { text-align: center; margin-bottom: 0.9em; }
  h1 { font-size: 1.7rem; letter-spacing: 0.02em; }
  .contact { font-size: 0.95rem; color: #333; margin-top: 0.15em; }
  h2 {
    font-size: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border-bottom: 1px solid #222;
    padding-bottom: 0.15em;
    margin: 0.9em 0 0.4em;
  }
  .summary { font-size: 0.98rem; }
  .skill-line { font-size: 0.95rem; margin-bottom: 0.15em; }
  .skill-line .group { font-weight: 600; }
  .role { margin-bottom: 0.55em; }
  .role-head { display: flex; justify-content: space-between; flex-wrap: wrap; }
  .role-title { font-weight: 600; font-size: 1rem; }
  .role-meta { color: #333; font-size: 0.92rem; }
  ul.bullets { margin: 0.15em 0 0 1.25em; }
  ul.bullets li { font-size: 0.95rem; margin-bottom: 0.12em; }
  .edu, .cert { font-size: 0.95rem; margin-bottom: 0.15em; }
  @media print {
    html { font-size: 10.5px; }
    body { padding: 0; max-width: none; }
    @page { size: Letter; margin: 0.6in; }
  }
`;

function headerHtml(contact) {
  const parts = [contact?.location, contact?.email].filter(Boolean).map(e).join(' · ');
  return `<header>
<h1>${e(contact?.name)}</h1>
<div class="contact">${parts}</div>
</header>`;
}

function summaryHtml(master, selection) {
  const text = selection
    ? selection.summary_text
    : Object.values(master.summary_variants || {})[0] || '';
  if (!text) return '';
  return `<h2>Summary</h2>\n<p class="summary">${e(text)}</p>`;
}

function skillsHtml(master, selection) {
  let groups;
  if (selection) {
    groups = selection.skills.map((g) => ({ group: g.group, items: g.items }));
  } else {
    groups = (master.skills || []).map((g) => ({
      group: g.group,
      items: (g.items || []).map((i) => i.name),
    }));
  }
  if (!groups.length) return '';
  const lines = groups
    .map(
      (g) =>
        `<div class="skill-line"><span class="group">${e(g.group)}:</span> ${g.items.map(e).join(', ')}</div>`,
    )
    .join('\n');
  return `<h2>Skills</h2>\n${lines}`;
}

function experienceHtml(master, selection) {
  const roles = [];
  for (const masterRole of master.experience || []) {
    let bullets;
    if (selection) {
      const selRole = selection.experience.find((r) => r.company === masterRole.company);
      if (!selRole) continue; // role omitted by the tailor
      bullets = selRole.bullets.map((b) => b.text);
    } else {
      bullets = (masterRole.bullets || []).map((b) => b.text);
    }
    const meta = [masterRole.location, `${masterRole.start} – ${masterRole.end}`]
      .filter(Boolean)
      .map(e)
      .join(' · ');
    roles.push(`<div class="role">
<div class="role-head">
<span class="role-title">${e(masterRole.company)} — ${e(masterRole.title)}</span>
<span class="role-meta">${meta}</span>
</div>
<ul class="bullets">
${bullets.map((b) => `<li>${e(b)}</li>`).join('\n')}
</ul>
</div>`);
  }
  if (!roles.length) return '';
  return `<h2>Experience</h2>\n${roles.join('\n')}`;
}

function educationHtml(master) {
  const rows = (master.education || []).map(
    (ed) =>
      `<div class="edu"><strong>${e(ed.school)}</strong> — ${e(ed.degree)}${
        ed.graduated ? `, ${e(ed.graduated)}` : ''
      }${ed.location ? ` (${e(ed.location)})` : ''}</div>`,
  );
  if (!rows.length) return '';
  return `<h2>Education</h2>\n${rows.join('\n')}`;
}

function certificationsHtml(master, selection) {
  const certs = master.certifications || [];
  let chosen;
  if (selection) {
    chosen = selection.certification_indices.map((i) => certs[i]).filter(Boolean);
  } else {
    chosen = certs;
  }
  // Never render certs whose master entry carries a note (needs human review).
  chosen = chosen.filter((c) => c && !c.note);
  if (!chosen.length) return '';
  const rows = chosen.map(
    (c) => `<div class="cert">${e(c.name)}${c.date ? ` — ${e(c.date)}` : ''}</div>`,
  );
  return `<h2>Certifications</h2>\n${rows.join('\n')}`;
}

/**
 * @param {object} master structured master resume JSON
 * @param {object|null} selection validated tailor selection, or null for the full master
 * @returns {string} standalone HTML document
 */
export function renderResume(master, selection = null) {
  const name = master?.contact?.name || 'Resume';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(name)} — Resume</title>
<style>${STYLE}</style>
</head>
<body>
${headerHtml(master?.contact)}
${summaryHtml(master, selection)}
${skillsHtml(master, selection)}
${experienceHtml(master, selection)}
${educationHtml(master)}
${certificationsHtml(master, selection)}
</body>
</html>`;
}
