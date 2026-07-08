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
      if (btn.dataset.tab === 'settings') {
        loadSettings();
        loadWatchlist();
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

async function loadPipeline() {
  const board = document.getElementById('board');
  board.textContent = '';

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

  panel.hidden = false;
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

function buildJobRow(job) {
  const tr = document.createElement('tr');

  const tdTitle = document.createElement('td');
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
  tdCompany.textContent = job.company;
  tr.appendChild(tdCompany);

  const tdLocation = document.createElement('td');
  tdLocation.textContent = job.location || '';
  tr.appendChild(tdLocation);

  const tdSalary = document.createElement('td');
  tdSalary.textContent = job.salary_text || '';
  tr.appendChild(tdSalary);

  const tdSource = document.createElement('td');
  tdSource.textContent = job.source || '';
  tr.appendChild(tdSource);

  const tdPosted = document.createElement('td');
  tdPosted.textContent = job.posted_at ? new Date(job.posted_at).toLocaleDateString() : '';
  tr.appendChild(tdPosted);

  const tdActions = document.createElement('td');
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

  tdActions.appendChild(actions);
  tr.appendChild(tdActions);

  return tr;
}

async function loadJobs() {
  const tbody = document.getElementById('jobs-tbody');
  const empty = document.getElementById('jobs-empty');
  tbody.textContent = '';

  const query = currentJobsFilter === 'all' ? '' : `?triage=${currentJobsFilter}`;
  let jobs;
  try {
    jobs = await apiJson(`/api/jobs${query}`);
  } catch (err) {
    return;
  }

  if (!jobs || jobs.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

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

function initScanButton() {
  const btn = document.getElementById('scan-now-btn');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Scanning…';
    try {
      const result = await apiJson('/api/ingest', { method: 'POST', body: JSON.stringify({}) });
      const parts = (result.summaries || []).map(
        (s) => `${s.source}: +${s.inserted} new (${s.skipped_duplicate} dup, ${s.skipped_filtered} filtered)`,
      );
      showToast(parts.length ? parts.join(' | ') : 'Scan finished.');
      await loadJobs();
      await loadLastScan();
    } catch (err) {
      if (err && err.status === 409) {
        showToast('A scan is already running.', true);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Scan now';
    }
  });
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
  form.elements.min_salary.value = profile.min_salary != null ? profile.min_salary : '';
  form.elements.score_threshold.value = profile.score_threshold != null ? profile.score_threshold : '';
  form.elements.remote_only.checked = !!profile.remote_only;
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
    const payload = {
      target_titles: titles,
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
