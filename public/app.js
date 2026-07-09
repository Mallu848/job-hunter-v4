'use strict';

const STORAGE_KEY = 'jh_secret';
const STATUS_COLUMNS = [
  { key: 'saved', label: 'Saved' },
  { key: 'applied', label: 'Applied' },
  { key: 'interview', label: 'Interview' },
  { key: 'offer', label: 'Offer' },
  { key: 'rejected', label: 'Rejected' },
];

let currentJobsFilter = 'new';
let activeApplicationId = null;
let cachedThreshold = 55;

// ---------- Toasts ----------

function showToast(message, isError) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = isError ? 'toast error' : 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

// ---------- Auth / fetch wrapper ----------

function getSecret() {
  return localStorage.getItem(STORAGE_KEY) || '';
}

function setSecret(secret) {
  localStorage.setItem(STORAGE_KEY, secret);
}

function clearSecret() {
  localStorage.removeItem(STORAGE_KEY);
}

async function apiFetch(path, options = {}) {
  const headers = Object.assign({}, options.headers, {
    'x-app-secret': getSecret(),
  });
  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(path, Object.assign({}, options, { headers }));
  } catch (err) {
    showToast('Network error — check your connection.', true);
    throw err;
  }

  if (res.status === 401) {
    clearSecret();
    showLockScreen('Session expired — enter the app secret again.');
    throw new Error('Unauthorized');
  }

  return res;
}

async function apiJson(path, options) {
  const res = await apiFetch(path, options);
  let body = null;
  try {
    body = await res.json();
  } catch (err) {
    body = null;
  }
  if (!res.ok) {
    const message = (body && body.error) || `Request failed (${res.status})`;
    if (res.status !== 409) {
      showToast(message, true);
    }
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// ---------- Lock screen ----------

function showLockScreen(errorMessage) {
  document.getElementById('app').hidden = true;
  const lockScreen = document.getElementById('lock-screen');
  lockScreen.hidden = false;
  const errorEl = document.getElementById('lock-error');
  if (errorMessage) {
    errorEl.textContent = errorMessage;
    errorEl.hidden = false;
  } else {
    errorEl.hidden = true;
  }
  document.getElementById('lock-input').focus();
}

function showApp() {
  document.getElementById('lock-screen').hidden = true;
  document.getElementById('app').hidden = false;
}

async function tryUnlock() {
  const secret = getSecret();
  if (!secret) {
    showLockScreen();
    return false;
  }
  const res = await fetch('/api/profile', { headers: { 'x-app-secret': secret } });
  if (res.status === 401) {
    showLockScreen();
    return false;
  }
  showApp();
  return true;
}

function initLockForm() {
  const form = document.getElementById('lock-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('lock-input');
    const value = input.value.trim();
    if (!value) return;
    setSecret(value);
    input.value = '';
    const ok = await tryUnlock();
    if (ok) {
      await initAppData();
    }
  });
}

// ---------- Tabs ----------

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
      const panel = document.getElementById(`tab-${btn.dataset.tab}`);
      panel.classList.add('active');
      if (btn.dataset.tab === 'pipeline') loadPipeline();
      if (btn.dataset.tab === 'jobs') {
        loadJobs();
        loadLastScan();
      }
      if (btn.dataset.tab === 'resumes') loadResumes();
      if (btn.dataset.tab === 'settings') {
        loadSettings();
        loadWatchlist();
        loadUsage();
      }
    });
  });
  buttons[0].classList.add('active');
  document.getElementById('tab-pipeline').classList.add('active');
}

function switchToTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });
}

// ---------- Pipeline (kanban) ----------

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

function buildCard(app) {
  const card = document.createElement('div');
  card.className = 'board-card';
  card.dataset.id = String(app.id);
  card.dataset.status = app.status; // drives the green/yellow/red status accent

  const company = document.createElement('div');
  company.className = 'card-company';
  company.textContent = app.job ? app.job.company : '(unknown company)';
  card.appendChild(company);

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = app.job ? app.job.title : '(unknown title)';
  card.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'card-meta';

  const days = document.createElement('span');
  days.textContent = `${daysSince(app.updated_at || app.created_at)}d in stage`;
  meta.appendChild(days);

  if (app.next_action_date) {
    const nad = document.createElement('span');
    nad.textContent = `Next: ${app.next_action_date}`;
    meta.appendChild(nad);
  }

  card.appendChild(meta);

  card.addEventListener('click', () => openDetailPanel(app));

  return card;
}

function pct(rateValue) {
  return rateValue == null ? '—' : `${Math.round(rateValue * 1000) / 10}%`;
}

// Stats strip above the kanban. Failure hides the strip and never breaks
// the board itself.
async function loadStats() {
  const strip = document.getElementById('stats-strip');
  const variantWrap = document.getElementById('variant-stats');
  const variantTbody = document.getElementById('variant-tbody');

  let stats;
  try {
    stats = await apiJson('/api/stats');
  } catch (err) {
    strip.hidden = true;
    variantWrap.hidden = true;
    return;
  }

  strip.textContent = '';
  const entries = [
    ['saved', 'Saved', stats.pipeline.saved],
    ['applied', 'Applied', stats.pipeline.applied],
    ['interview', 'Interview', stats.pipeline.interview],
    ['offer', 'Offer', stats.pipeline.offer],
    ['rejected', 'Rejected', stats.pipeline.rejected],
  ];
  for (const [status, label, count] of entries) {
    const cell = document.createElement('span');
    cell.className = 'stat-cell';
    cell.dataset.status = status; // drives the green/yellow/red status accent
    const num = document.createElement('strong');
    num.textContent = String(count);
    cell.appendChild(num);
    cell.appendChild(document.createTextNode(` ${label}`));
    strip.appendChild(cell);
  }
  const rates = document.createElement('span');
  rates.className = 'stat-rates';
  rates.textContent = `Applied→Interview: ${pct(stats.funnel.applied_to_interview)} · Interview→Offer: ${pct(stats.funnel.interview_to_offer)}`;
  strip.appendChild(rates);
  strip.hidden = false;

  // Variant table: hidden when empty or all-zero.
  variantTbody.textContent = '';
  const rows = (stats.by_variant || []).filter((v) => v.ever_applied > 0 || v.ever_interview > 0);
  if (!rows.length) {
    variantWrap.hidden = true;
    return;
  }
  for (const v of rows) {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = v.variant;
    tr.appendChild(tdName);
    const tdApplied = document.createElement('td');
    tdApplied.textContent = String(v.ever_applied);
    tr.appendChild(tdApplied);
    const tdInterview = document.createElement('td');
    tdInterview.textContent = String(v.ever_interview);
    tr.appendChild(tdInterview);
    const tdRate = document.createElement('td');
    tdRate.textContent = pct(v.applied_to_interview);
    tr.appendChild(tdRate);
    variantTbody.appendChild(tr);
  }
  variantWrap.hidden = false;
}

async function loadPipeline() {
  const board = document.getElementById('board');
  board.textContent = '';

  loadStats(); // fire-and-forget: stats failure must not block the kanban

  const columns = {};
  STATUS_COLUMNS.forEach(({ key, label }) => {
    const col = document.createElement('div');
    col.className = 'board-column';
    col.dataset.status = key;
    const heading = document.createElement('h3');
    heading.textContent = label;
    col.appendChild(heading);
    board.appendChild(col);
    columns[key] = col;
  });

  let apps;
  try {
    apps = await apiJson('/api/applications');
  } catch (err) {
    return;
  }

  if (!apps || apps.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No applications yet. Track a job from the Jobs tab.';
    board.appendChild(empty);
    return;
  }

  apps.forEach((app) => {
    const col = columns[app.status] || columns.saved;
    col.appendChild(buildCard(app));
  });
}

// ---------- Detail panel ----------

function openDetailPanel(app) {
  activeApplicationId = app.id;
  const panel = document.getElementById('detail-panel');
  document.getElementById('detail-title').textContent = app.job
    ? `${app.job.title} @ ${app.job.company}`
    : 'Application';

  const link = document.getElementById('detail-link');
  if (app.job && app.job.url) {
    link.href = app.job.url;
    link.hidden = false;
  } else {
    link.hidden = true;
  }

  document.getElementById('detail-status').value = app.status;
  document.getElementById('detail-next-action').value = app.next_action || '';
  document.getElementById('detail-next-action-date').value = app.next_action_date || '';
  document.getElementById('detail-notes').value = app.notes || '';

  loadEvents(app.id);
  loadResumeOptions(app);

  panel.hidden = false;
}

// Offer a resume link when the application's job has tailored resumes.
async function loadResumeOptions(app) {
  const label = document.getElementById('detail-resume-label');
  const select = document.getElementById('detail-resume');
  select.textContent = '';
  label.hidden = true;
  if (!app.job_id) return;

  let all;
  try {
    all = await apiJson('/api/resumes');
  } catch (err) {
    return;
  }
  const tailored = (all || []).filter((r) => r.kind === 'tailored' && r.job_id === app.job_id);
  if (!tailored.length) return;

  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '(none)';
  select.appendChild(noneOpt);
  for (const r of tailored) {
    const opt = document.createElement('option');
    opt.value = String(r.id);
    const when = r.created_at ? new Date(r.created_at).toLocaleDateString() : '';
    opt.textContent = `Tailored #${r.id}${when ? ` (${when})` : ''}`;
    select.appendChild(opt);
  }
  select.value = app.resume_id ? String(app.resume_id) : '';
  label.hidden = false;
}

function closeDetailPanel() {
  document.getElementById('detail-panel').hidden = true;
  activeApplicationId = null;
}

async function loadEvents(applicationId) {
  const list = document.getElementById('detail-events');
  list.textContent = '';
  let events;
  try {
    events = await apiJson(`/api/applications/${applicationId}/events`);
  } catch (err) {
    return;
  }
  if (!events || events.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No history yet.';
    list.appendChild(li);
    return;
  }
  events.forEach((ev) => {
    const li = document.createElement('li');
    const from = ev.from_status ? ev.from_status : 'created';
    const when = ev.occurred_at ? new Date(ev.occurred_at).toLocaleString() : '';
    li.textContent = `${from} → ${ev.to_status} (${when})`;
    list.appendChild(li);
  });
}

function initDetailPanel() {
  document.getElementById('detail-close').addEventListener('click', closeDetailPanel);
  document.getElementById('detail-backdrop').addEventListener('click', closeDetailPanel);

  document.getElementById('detail-status').addEventListener('change', async (e) => {
    if (!activeApplicationId) return;
    try {
      await apiJson(`/api/applications/${activeApplicationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: e.target.value }),
      });
      await loadEvents(activeApplicationId);
      await loadPipeline();
      showToast('Status updated.');
    } catch (err) {
      // toast already shown by apiJson
    }
  });

  document.getElementById('detail-resume').addEventListener('change', async (e) => {
    if (!activeApplicationId) return;
    const value = e.target.value ? Number(e.target.value) : null;
    try {
      await apiJson(`/api/applications/${activeApplicationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ resume_id: value }),
      });
      showToast(value ? 'Resume linked.' : 'Resume unlinked.');
    } catch (err) {
      // toast already shown
    }
  });

  document.getElementById('detail-notes').addEventListener('blur', async (e) => {
    if (!activeApplicationId) return;
    try {
      await apiJson(`/api/applications/${activeApplicationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes: e.target.value }),
      });
    } catch (err) {
      // toast already shown
    }
  });

  document.getElementById('detail-next-action').addEventListener('blur', async (e) => {
    if (!activeApplicationId) return;
    try {
      await apiJson(`/api/applications/${activeApplicationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ next_action: e.target.value }),
      });
    } catch (err) {
      // toast already shown
    }
  });

  document.getElementById('detail-next-action-date').addEventListener('change', async (e) => {
    if (!activeApplicationId) return;
    try {
      await apiJson(`/api/applications/${activeApplicationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ next_action_date: e.target.value || null }),
      });
      await loadPipeline();
    } catch (err) {
      // toast already shown
    }
  });
}

// ---------- Jobs tab ----------

function buildScoreBadge(job) {
  const badge = document.createElement('span');
  badge.className = 'score-badge';
  if (job.score == null) {
    badge.classList.add('score-none');
    badge.textContent = '—';
  } else {
    badge.textContent = String(job.score);
    if (job.score >= 70) badge.classList.add('score-high');
    else if (job.score >= cachedThreshold) badge.classList.add('score-mid');
    else badge.classList.add('score-low');
  }
  return badge;
}

function appendReasonList(container, label, items) {
  if (!Array.isArray(items) || items.length === 0) return;
  const wrap = document.createElement('div');
  wrap.className = 'reason-group';
  const heading = document.createElement('span');
  heading.className = 'reason-label';
  heading.textContent = label;
  wrap.appendChild(heading);
  const ul = document.createElement('ul');
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = String(item);
    ul.appendChild(li);
  });
  wrap.appendChild(ul);
  container.appendChild(wrap);
}

function buildScoreDetailsRow(job) {
  const tr = document.createElement('tr');
  tr.className = 'score-details-row';
  const td = document.createElement('td');
  td.colSpan = 8;
  const r = job.score_reasons || {};
  appendReasonList(td, 'Reasons', r.reasons);
  appendReasonList(td, 'Matched skills', r.matched_skills);
  appendReasonList(td, 'Missing keywords', r.missing_keywords);
  appendReasonList(td, 'Red flags', r.red_flags);
  if (!td.hasChildNodes()) {
    td.textContent = 'Not scored yet.';
  }
  tr.appendChild(td);
  return tr;
}

function buildJobRow(job) {
  const tr = document.createElement('tr');
  tr.className = 'job-row';

  // data-label drives the mobile card layout (td::before shows the label).
  const tdScore = document.createElement('td');
  tdScore.dataset.label = 'Score';
  tdScore.appendChild(buildScoreBadge(job));
  tr.appendChild(tdScore);

  const tdTitle = document.createElement('td');
  tdTitle.dataset.label = 'Title';
  if (job.url) {
    const a = document.createElement('a');
    a.href = job.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = job.title;
    tdTitle.appendChild(a);
  } else {
    tdTitle.textContent = job.title;
  }
  tr.appendChild(tdTitle);

  const tdCompany = document.createElement('td');
  tdCompany.dataset.label = 'Company';
  tdCompany.textContent = job.company;
  tr.appendChild(tdCompany);

  const tdLocation = document.createElement('td');
  tdLocation.dataset.label = 'Location';
  tdLocation.textContent = job.location || '';
  tr.appendChild(tdLocation);

  const tdSalary = document.createElement('td');
  tdSalary.dataset.label = 'Salary';
  tdSalary.textContent = job.salary_text || '';
  tr.appendChild(tdSalary);

  const tdSource = document.createElement('td');
  tdSource.dataset.label = 'Source';
  tdSource.textContent = job.source || '';
  tr.appendChild(tdSource);

  const tdPosted = document.createElement('td');
  tdPosted.dataset.label = 'Posted';
  tdPosted.textContent = job.posted_at ? new Date(job.posted_at).toLocaleDateString() : '';
  tr.appendChild(tdPosted);

  const tdActions = document.createElement('td');
  tdActions.className = 'actions-cell';
  const actions = document.createElement('div');
  actions.className = 'row-actions';

  const shortlistBtn = document.createElement('button');
  shortlistBtn.type = 'button';
  shortlistBtn.className = 'btn-secondary';
  shortlistBtn.textContent = 'Shortlist';
  shortlistBtn.addEventListener('click', async () => {
    try {
      await apiJson(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ triage: 'shortlisted' }),
      });
      showToast('Job shortlisted.');
      await loadJobs();
    } catch (err) {
      // toast already shown
    }
  });
  actions.appendChild(shortlistBtn);

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'btn-danger';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', async () => {
    try {
      await apiJson(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ triage: 'dismissed' }),
      });
      showToast('Job dismissed.');
      await loadJobs();
    } catch (err) {
      // toast already shown
    }
  });
  actions.appendChild(dismissBtn);

  const trackBtn = document.createElement('button');
  trackBtn.type = 'button';
  trackBtn.textContent = 'Track';
  trackBtn.addEventListener('click', async () => {
    try {
      await apiJson('/api/applications', {
        method: 'POST',
        body: JSON.stringify({ job_id: job.id }),
      });
      showToast('Application created.');
      switchToTab('pipeline');
      await loadPipeline();
    } catch (err) {
      // toast already shown
    }
  });
  actions.appendChild(trackBtn);

  const tailorBtn = document.createElement('button');
  tailorBtn.type = 'button';
  tailorBtn.className = 'btn-secondary';
  tailorBtn.textContent = 'Tailor';
  tailorBtn.addEventListener('click', async () => {
    tailorBtn.disabled = true;
    tailorBtn.textContent = 'Tailoring… ~30s';
    try {
      const result = await apiJson(`/api/jobs/${job.id}/tailor`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      showToast(`Resume tailored (${result.bullet_count} bullets, ${result.roles} roles).`);
      switchToTab('resumes');
      await loadResumes();
      await showDiff(result.resume_id);
    } catch (err) {
      // apiJson already toasted the server's error message
    } finally {
      tailorBtn.disabled = false;
      tailorBtn.textContent = 'Tailor';
    }
  });
  actions.appendChild(tailorBtn);

  tdActions.appendChild(actions);
  tr.appendChild(tdActions);

  // Click anywhere on the row (except links/buttons) toggles score details.
  tr.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('a')) return;
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('score-details-row')) {
      next.remove();
    } else {
      tr.after(buildScoreDetailsRow(job));
    }
  });

  return tr;
}

async function loadJobs() {
  const tbody = document.getElementById('jobs-tbody');
  const empty = document.getElementById('jobs-empty');
  tbody.textContent = '';

  const query = currentJobsFilter === 'all' ? '' : `?triage=${currentJobsFilter}`;
  let jobs;
  try {
    const [jobsResult, profile] = await Promise.all([
      apiJson(`/api/jobs${query}`),
      apiJson('/api/profile'),
    ]);
    jobs = jobsResult;
    if (profile && profile.score_threshold != null) cachedThreshold = profile.score_threshold;
  } catch (err) {
    return;
  }

  if (!jobs || jobs.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  // Score desc, unscored last (stable: keeps newest-first within equal scores).
  jobs.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  jobs.forEach((job) => tbody.appendChild(buildJobRow(job)));
}

function initJobsFilterBar() {
  const bar = document.getElementById('jobs-filter-bar');
  const buttons = bar.querySelectorAll('.filter-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentJobsFilter = btn.dataset.filter;
      loadJobs();
    });
  });
  const defaultBtn = bar.querySelector('[data-filter="new"]');
  defaultBtn.classList.add('active');
}

function initAddJobForm() {
  const form = document.getElementById('add-job-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = {
      title: String(data.get('title') || '').trim(),
      company: String(data.get('company') || '').trim(),
      url: String(data.get('url') || '').trim() || undefined,
      location: String(data.get('location') || '').trim() || undefined,
      salary_text: String(data.get('salary_text') || '').trim() || undefined,
      remote: data.get('remote') === 'on',
      description: String(data.get('description') || '').trim() || undefined,
    };

    try {
      await apiJson('/api/jobs', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Job added.');
      form.reset();
      await loadJobs();
    } catch (err) {
      if (err && err.status === 409) {
        showToast('That job already exists (duplicate company + title).', true);
      }
    }
  });
}

// ---------- Scan now / last scan ----------

async function loadLastScan() {
  const line = document.getElementById('last-scan-line');
  let runs;
  try {
    runs = await apiJson('/api/ingest/runs?limit=1');
  } catch (err) {
    return;
  }
  if (!runs || runs.length === 0) {
    line.textContent = 'No scans yet.';
    return;
  }
  const r = runs[0];
  const when = r.finished_at || r.started_at;
  const ts = when ? new Date(when).toLocaleString() : 'unknown time';
  line.textContent = `Last scan: ${ts} (${r.source}: +${r.inserted} new, ${r.skipped_duplicate} dup, ${r.skipped_filtered} filtered)`;
}

// Scan runs in the background server-side (202), so poll /status every 5s
// (max ~4 min) until it reports not-running, then refresh.
const SCAN_POLL_MS = 5000;
const SCAN_POLL_MAX = 48;

function initScanButton() {
  const btn = document.getElementById('scan-now-btn');
  const line = document.getElementById('last-scan-line');

  async function pollUntilDone() {
    for (let i = 0; i < SCAN_POLL_MAX; i++) {
      await new Promise((r) => setTimeout(r, SCAN_POLL_MS));
      let status;
      try {
        status = await apiJson('/api/ingest/status');
      } catch (err) {
        return false; // toast already shown; stop polling
      }
      if (!status.running) {
        const parts = (status.last_runs || []).map(
          (s) => `${s.source}: +${s.inserted} new (${s.skipped_duplicate} dup, ${s.skipped_filtered} filtered)`,
        );
        showToast(parts.length ? parts.join(' | ') : 'Scan finished.');
        return true;
      }
    }
    showToast('Scan is taking longer than expected — check back shortly.', true);
    return false;
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Scanning…';
    line.textContent = 'scanning…';
    try {
      await apiJson('/api/ingest', { method: 'POST', body: JSON.stringify({}) });
      await pollUntilDone();
      await loadJobs();
      await loadLastScan();
    } catch (err) {
      if (err && err.status === 409) {
        showToast('A scan is already running.', true);
      }
      await loadLastScan();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Scan now';
    }
  });
}

// ---------- Resumes tab ----------

function resumeLabel(r) {
  if (r.kind === 'master') return 'Master resume';
  const jobPart = r.job ? `${r.job.title} @ ${r.job.company}` : `job #${r.job_id}`;
  return `Tailored — ${jobPart}`;
}

function buildResumeItem(r) {
  const li = document.createElement('li');

  const name = document.createElement('span');
  name.className = 'wl-name';
  name.textContent = resumeLabel(r);
  li.appendChild(name);

  const meta = document.createElement('span');
  meta.className = 'wl-meta';
  meta.textContent = r.created_at ? new Date(r.created_at).toLocaleDateString() : '';
  li.appendChild(meta);

  // Print view works for both kinds: tailored rows have stored HTML and the
  // master is rendered on the fly by GET /api/resumes/:id.
  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'btn-secondary';
  printBtn.textContent = 'Open print view';
  printBtn.addEventListener('click', () => openPrintView(r.id));

  if (r.kind === 'tailored') {
    const diffBtn = document.createElement('button');
    diffBtn.type = 'button';
    diffBtn.className = 'btn-secondary';
    diffBtn.textContent = 'View diff';
    diffBtn.addEventListener('click', () => showDiff(r.id));
    li.appendChild(diffBtn);
  }

  li.appendChild(printBtn);

  if (r.kind === 'tailored') {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      try {
        await apiJson(`/api/resumes/${r.id}`, { method: 'DELETE' });
        showToast('Tailored resume deleted.');
        document.getElementById('diff-view').hidden = true;
        await loadResumes();
      } catch (err) {
        // toast already shown (409 message explains the linked application)
      }
    });
    li.appendChild(deleteBtn);
  }

  return li;
}

async function loadResumes() {
  const list = document.getElementById('resumes-list');
  const empty = document.getElementById('resumes-empty');
  list.textContent = '';

  let rows;
  try {
    rows = await apiJson('/api/resumes');
  } catch (err) {
    return;
  }

  if (!rows || rows.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  rows.forEach((r) => list.appendChild(buildResumeItem(r)));
}

// Fetch renderedHtml with the auth header and open it via a blob URL —
// never put the secret in a URL.
async function openPrintView(resumeId) {
  let row;
  try {
    row = await apiJson(`/api/resumes/${resumeId}`);
  } catch (err) {
    return;
  }
  if (!row.rendered_html) {
    showToast('No rendered HTML for this resume.', true);
    return;
  }
  const blob = new Blob([row.rendered_html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function diffSection(title) {
  const wrap = document.createElement('div');
  wrap.className = 'diff-section';
  const h = document.createElement('h3');
  h.textContent = title;
  wrap.appendChild(h);
  return wrap;
}

function mutedLine(text) {
  const div = document.createElement('div');
  div.className = 'diff-muted';
  div.textContent = text;
  return div;
}

async function showDiff(resumeId) {
  let row;
  try {
    row = await apiJson(`/api/resumes/${resumeId}`);
  } catch (err) {
    return;
  }
  const selection = row.content?.selection;
  const master = row.content?.master_snapshot;
  if (!selection || !master) {
    showToast('This resume has no diffable content.', true);
    return;
  }

  const view = document.getElementById('diff-view');
  const title = document.getElementById('diff-title');
  const body = document.getElementById('diff-body');
  body.textContent = '';
  title.textContent = `Master vs tailored (resume #${row.id})`;

  // Summary
  const summarySec = diffSection(`Summary — variant "${selection.summary_variant}"`);
  const finalSummary = document.createElement('p');
  finalSummary.textContent = selection.summary_text;
  summarySec.appendChild(finalSummary);
  const masterSummary = master.summary_variants?.[selection.summary_variant];
  if (masterSummary && masterSummary !== selection.summary_text) {
    summarySec.appendChild(mutedLine(`master: ${masterSummary}`));
  }
  body.appendChild(summarySec);

  // Skills
  const skillsSec = diffSection('Skills (as tailored)');
  for (const g of selection.skills) {
    const line = document.createElement('div');
    line.className = 'skill-line';
    const label = document.createElement('strong');
    label.textContent = `${g.group}: `;
    line.appendChild(label);
    line.appendChild(document.createTextNode(g.items.join(', ')));
    skillsSec.appendChild(line);
  }
  body.appendChild(skillsSec);

  // Keywords woven
  if (Array.isArray(selection.keywords_woven) && selection.keywords_woven.length) {
    const kwSec = diffSection('Keywords woven');
    const chipRow = document.createElement('div');
    chipRow.className = 'chip-row';
    for (const kw of selection.keywords_woven) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = kw;
      chipRow.appendChild(chip);
    }
    kwSec.appendChild(chipRow);
    body.appendChild(kwSec);
  }

  // Experience: master bullets vs tailored picks
  const expSec = diffSection('Experience');
  for (const masterRole of master.experience || []) {
    const roleDiv = document.createElement('div');
    roleDiv.className = 'diff-role';
    const roleHead = document.createElement('h4');
    roleHead.textContent = `${masterRole.company} — ${masterRole.title}`;
    roleDiv.appendChild(roleHead);

    const selRole = (selection.experience || []).find((r) => r.company === masterRole.company);
    const ul = document.createElement('ul');
    ul.className = 'diff-bullets';

    (masterRole.bullets || []).forEach((mb, idx) => {
      const selBullet = selRole?.bullets.find((b) => b.index === idx);
      const li = document.createElement('li');
      if (selBullet) {
        li.textContent = selBullet.text;
        if (selBullet.text !== mb.text) {
          li.appendChild(mutedLine(`master: ${mb.text}`));
        }
      } else {
        li.className = 'diff-excluded';
        li.textContent = mb.text;
      }
      ul.appendChild(li);
    });

    if (!selRole) {
      roleDiv.appendChild(mutedLine('(role omitted from tailored resume)'));
    }
    roleDiv.appendChild(ul);
    expSec.appendChild(roleDiv);
  }
  body.appendChild(expSec);

  view.hidden = false;
  view.scrollIntoView({ behavior: 'smooth' });
}

// ---------- Watchlist (Settings tab) ----------

function buildWatchlistItem(company) {
  const li = document.createElement('li');
  if (!company.active) li.classList.add('inactive');

  const name = document.createElement('span');
  name.className = 'wl-name';
  name.textContent = company.name;
  li.appendChild(name);

  const meta = document.createElement('span');
  meta.className = 'wl-meta';
  meta.textContent = `${company.ats} / ${company.board_slug}`;
  li.appendChild(meta);

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'btn-secondary';
  toggleBtn.textContent = company.active ? 'Disable' : 'Enable';
  toggleBtn.addEventListener('click', async () => {
    try {
      await apiJson(`/api/watchlist/${company.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !company.active }),
      });
      await loadWatchlist();
    } catch (err) {
      // toast already shown
    }
  });
  li.appendChild(toggleBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', async () => {
    try {
      await apiJson(`/api/watchlist/${company.id}`, { method: 'DELETE' });
      showToast('Removed from watchlist.');
      await loadWatchlist();
    } catch (err) {
      // toast already shown
    }
  });
  li.appendChild(deleteBtn);

  return li;
}

async function loadWatchlist() {
  const list = document.getElementById('watchlist-list');
  const empty = document.getElementById('watchlist-empty');
  list.textContent = '';

  let companies;
  try {
    companies = await apiJson('/api/watchlist');
  } catch (err) {
    return;
  }

  if (!companies || companies.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  companies.forEach((c) => list.appendChild(buildWatchlistItem(c)));
}

function initWatchlistForm() {
  const form = document.getElementById('watchlist-add-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = {
      name: String(data.get('name') || '').trim(),
      ats: String(data.get('ats') || 'greenhouse'),
      board_slug: String(data.get('board_slug') || '').trim(),
    };
    try {
      await apiJson('/api/watchlist', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Company added to watchlist.');
      form.reset();
      await loadWatchlist();
    } catch (err) {
      if (err && err.status === 409) {
        showToast('That company/board is already on the watchlist.', true);
      }
    }
  });
}

// ---------- Settings tab ----------

async function loadSettings() {
  let profile;
  try {
    profile = await apiJson('/api/profile');
  } catch (err) {
    return;
  }
  const form = document.getElementById('settings-form');
  form.elements.target_titles.value = (profile.target_titles || []).join(', ');
  form.elements.exclude_keywords.value = (profile.exclude_keywords || []).join(', ');
  form.elements.min_salary.value = profile.min_salary != null ? profile.min_salary : '';
  form.elements.score_threshold.value = profile.score_threshold != null ? profile.score_threshold : '';
  form.elements.remote_only.checked = !!profile.remote_only;
}

async function loadUsage() {
  const line = document.getElementById('usage-line');
  let usage;
  try {
    usage = await apiJson('/api/usage');
  } catch (err) {
    return;
  }
  line.textContent = `AI usage this month: ${usage.calls} call${usage.calls === 1 ? '' : 's'}, $${usage.cost_usd.toFixed(4)}`;
}

function initSettingsForm() {
  const form = document.getElementById('settings-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const titles = String(data.get('target_titles') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const excludes = String(data.get('exclude_keywords') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const payload = {
      target_titles: titles,
      exclude_keywords: excludes,
      remote_only: data.get('remote_only') === 'on',
    };
    const minSalary = data.get('min_salary');
    payload.min_salary = minSalary ? Number(minSalary) : null;
    const scoreThreshold = data.get('score_threshold');
    if (scoreThreshold) payload.score_threshold = Number(scoreThreshold);

    try {
      await apiJson('/api/profile', { method: 'PATCH', body: JSON.stringify(payload) });
      showToast('Settings saved.');
    } catch (err) {
      // toast already shown
    }
  });
}

// ---------- Boot ----------

async function initAppData() {
  await loadPipeline();
}

async function init() {
  initLockForm();
  initTabs();
  initDetailPanel();
  initJobsFilterBar();
  initAddJobForm();
  initSettingsForm();
  initScanButton();
  initWatchlistForm();

  const ok = await tryUnlock();
  if (ok) {
    await initAppData();
  }
}

document.addEventListener('DOMContentLoaded', init);
