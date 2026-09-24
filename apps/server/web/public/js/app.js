function $(sel) {
  return document.querySelector(sel);
}

const API = {
  _csrf: null,
  async call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this._csrf) headers['X-CSRF-Token'] = this._csrf;
    const res = await fetch(path, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    if (!res.ok) {
      const err = new Error((payload && payload.error && payload.error.message) || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = payload && payload.error ? payload.error.code : null;
      throw err;
    }
    return payload ? payload.data : null;
  },
  get(path) { return this.call('GET', path); },
  post(path, body) { return this.call('POST', path, body !== undefined ? body : {}); },
  put(path, body) { return this.call('PUT', path, body || {}); },
  del(path) { return this.call('DELETE', path); },
  async getText(path) {
    const res = await fetch(path, { credentials: 'include' });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    return text;
  },
};

const App = {
  user: null,
  workspace: null,
  csrf: null,
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return esc(value);
  return d.toLocaleString();
}

function fmtAgo(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return esc(value);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_LABELS = {
  queued: 'Queued', running: 'Running', waiting: 'Waiting', paused: 'Paused',
  succeeded: 'Succeeded', completed: 'Completed', failed: 'Failed', canceled: 'Canceled',
  skipped: 'Skipped',
};

function statusPill(status) {
  const cls = { succeeded: 'ok', completed: 'ok', queued: 'muted', running: 'info', waiting: 'warn', paused: 'warn', failed: 'bad', canceled: 'muted', skipped: 'muted' }[status] || 'muted';
  return `<span class="pill pill-${cls}">${esc(STATUS_LABELS[status] || status)}</span>`;
}

function toast(message, kind) {
  let host = $('#toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind || 'info'}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// ---------- routing ----------

const routes = {
  'dashboard': renderDashboard,
  'workflows': renderWorkflows,
  'workflow-editor': renderWorkflowEditor,
  'workflow': renderWorkflowDetail,
  'runs': renderRuns,
  'run': renderRunDetail,
  'approvals': renderApprovals,
  'templates': renderTemplates,
  'audit': renderAudit,
  'credentials': renderCredentials,
  'members': renderMembers,
  'notifications': renderNotifications,
  'settings': renderSettings,
};

function parseHash() {
  const raw = (window.location.hash || '#/dashboard').replace(/^#\/?/, '');
  const [pathPart, ...rest] = raw.split('?')[0].split('/');
  const path = pathPart || 'dashboard';
  const id = rest.length ? decodeURIComponent(rest.join('/')) : null;
  // alias: #/workflows/new → editor
  if (path === 'workflows' && id === 'new') return { path: 'workflow-editor', id: null };
  return { path, id };
}

let currentPage = null;
let navToken = 0;

async function navigate() {
  const myToken = ++navToken;
  const { path } = parseHash();
  if (!App.user && (window.location.hash || '#/dashboard') !== '#/') {
    await boot();
    if (!App.user) return;
  }
  const target = (window.location.hash || '#/dashboard');
  if (!target.startsWith('#/') && target !== '#/') {
    window.location.hash = '#/dashboard';
    return;
  }
  const renderer = routes[path] || routes.dashboard;
  if (currentPage !== path) {
    currentPage = path;
    highlightNav(path);
    window.scrollTo({ top: 0 });
  }
  try {
    await renderer();
  } catch (err) {
    if (myToken !== navToken) return; // stale navigation lost the DOM race
    if (err && err.status === 401) {
      await renderAuth();
      return;
    }
    renderError(err);
  }
}

function highlightNav(path) {
  document.querySelectorAll('.nav-link').forEach((a) => {
    const key = a.getAttribute('data-route');
    if (!key) return;
    if (path === key || (key === 'workflows' && (path === 'workflow-editor' || path === 'workflow'))) {
      a.classList.add('active');
    } else {
      a.classList.remove('active');
    }
  });
}

function renderError(err) {
  const main = $('#main');
  main.innerHTML = `
    <div class="page-title">Something went wrong</div>
    <div class="panel">
      <p class="muted">${esc(err && err.message ? err.message : err)}</p>
      <p><a href="#/dashboard" class="link">Back to dashboard</a></p>
    </div>`;
}

// ---------- layout ----------

const NAV_ITEMS = [
  ['dashboard', 'Dashboard', '🏠'],
  ['workflows', 'Workflows', '⚙️'],
  ['runs', 'Runs', '▶'],
  ['approvals', 'Approvals', '✅'],
  ['templates', 'Templates', '🎨'],
  ['audit', 'Audit Log', '🧾'],
  ['credentials', 'Credentials', '🔐'],
  ['members', 'Members', '👥'],
  ['notifications', 'Notifications', '🔔'],
  ['settings', 'Settings', '🛠'],
];

function shell(content, pageKey) {
  const nav = NAV_ITEMS;
  const links = nav.map(([key, label, icon]) => `
    <a class="nav-link ${pageKey === key ? 'active' : ''}" data-route="${key}" href="#/${key}" title="${esc(label)}">
      <span class="nav-icon">${icon}</span><span class="nav-label">${esc(label)}</span>
    </a>`).join('');

  $('#app').innerHTML = `
    <div class="layout">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand" title="FlowForge Open">
          <span class="brand-mark">⬡</span><span class="brand-text">FlowForge</span>
        </div>
        <nav class="sidebar-nav">${links}</nav>
        <button class="collapse-btn" id="collapse-btn" title="Collapse sidebar">«</button>
      </aside>
      <div class="workspace">
        <header class="topbar">
          <div class="topbar-left">
            <button class="mobile-nav-btn" id="mobile-nav-btn">☰</button>
            <span class="crumb">${esc(App.workspace ? App.workspace.name : 'Workspace')}
              ${App.workspace && App.workspace.plan_id ? `<span class="pill pill-info" style="margin-left:8px">${esc(App.workspace.plan_id)} plan</span>` : ''}
            </span>
          </div>
          <div class="topbar-right">
            <span class="muted user-name">${esc(App.user ? App.user.name : '')}</span>
            <button class="btn ghost sm" id="logout-btn">Log out</button>
          </div>
        </header>
        <main id="main">${content}</main>
      </div>
    </div>`;

  $('#logout-btn').addEventListener('click', async () => {
    try { await API.post('/api/auth/logout'); } catch { /* ignore */ }
    App.user = null;
    API._csrf = null;
    currentPage = null;
    window.location.hash = '';
  });
  const collapse = $('#collapse-btn');
  collapse.addEventListener('click', () => {
    const sidebar = $('#sidebar');
    sidebar.classList.toggle('collapsed');
    collapse.textContent = sidebar.classList.contains('collapsed') ? '»' : '«';
  });
}

function defaultShell(content, pageKey) {
  shell(content, pageKey);
}

// ---------- auth ----------

async function boot() {
  try {
    await refreshMe();
    await navigate();
    return;
  } catch {
    await renderAuth();
  }
}

async function refreshMe() {
  const me = await API.get('/api/auth/me');
  if (!me || !me.user) throw new Error('not authenticated');
  App.user = me.user;
  App.workspace = me.workspace;
  App.role = me.role;
  API._csrf = me.csrf_token || API._csrf;
  return me;
}

async function renderAuth(mode) {
  const isRegister = mode === 'register';
  $('#app').innerHTML = `
    <div class="auth-wrap" data-testid="landing-hero">
      <div class="auth-card">
        <div class="auth-logo">⬡ FlowForge</div>
        <p class="auth-tagline">Open-source workflow automation for freelancers.<br/>Self-host the engine. Leave anytime — your manifests travel with you.</p>
        <div class="auth-form" id="auth-form"></div>
      </div>
    </div>`;
  renderAuthForm(isRegister);
}

function renderAuthForm(isRegister) {
  const host = $('#auth-form');
  if (isRegister) {
    host.innerHTML = `
      <h2>Create your workspace</h2>
      <div class="form-error hidden" id="form-error"></div>
      <label class="field">
        <span>Name</span>
        <input id="reg-name" placeholder="Ada Lovelace" autocomplete="name" />
      </label>
      <label class="field">
        <span>Email</span>
        <input id="reg-email" type="email" placeholder="you@example.com" autocomplete="email" />
      </label>
      <label class="field">
        <span>Password</span>
        <input id="reg-password" type="password" placeholder="12+ characters, letters and numbers" autocomplete="new-password" />
      </label>
      <label class="field">
        <span>Workspace name</span>
        <input id="reg-workspace" placeholder="My Studio" />
      </label>
      <button class="btn primary block" type="submit">Create account</button>
      <p class="auth-switch"><button class="link" id="show-login" type="button">Already have an account? Log in</button></p>`;
    $('#show-login').addEventListener('click', () => renderAuthForm(false));
    host.querySelector('button[type="submit"]').addEventListener('click', submitRegister);
  } else {
    host.innerHTML = `
      <h2>Log in to FlowForge</h2>
      <div class="form-error hidden" id="form-error"></div>
      <label class="field">
        <span>Email</span>
        <input id="login-email" type="email" placeholder="you@example.com" autocomplete="email" />
      </label>
      <label class="field">
        <span>Password</span>
        <input id="login-password" type="password" autocomplete="current-password" />
      </label>
      <button class="btn primary block" type="submit">Log in</button>
      <p class="auth-switch"><button class="link" id="show-register" type="button">New here? Create a workspace</button></p>
      <p class="auth-hint">Demo login: demo@acme.test · demo-password-changeme1</p>`;
    $('#show-register').addEventListener('click', () => renderAuthForm(true));
    host.querySelector('button[type="submit"]').addEventListener('click', submitLogin);
  }
}

function showFormError(message) {
  const el = $('#form-error');
  if (!el) return;
  el.textContent = message || 'Something went wrong';
  el.classList.remove('hidden');
}

async function submitLogin(event) {
  event.preventDefault();
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  if (!email || !password) {
    showFormError('Enter your email and password.');
    return;
  }
  try {
    const data = await API.post('/api/auth/login', { email, password });
    App.user = data.user;
    App.workspace = data.workspace;
    API._csrf = data.csrf_token;
    currentPage = null;
    // The hashchange listener is the single navigation driver.
    window.location.hash = '#/dashboard';
  } catch (err) {
    showFormError(err.message);
  }
}

async function submitRegister(event) {
  event.preventDefault();
  const name = $('#reg-name').value.trim();
  const email = $('#reg-email').value.trim();
  const password = $('#reg-password').value;
  const workspaceName = $('#reg-workspace').value.trim();
  if (!name || !email || !password) {
    showFormError('Fill in every field.');
    return;
  }
  try {
    const data = await API.post('/api/auth/register', { email, password, name, workspace_name: workspaceName });
    App.user = data.user;
    App.workspace = data.workspace;
    API._csrf = data.csrf_token;
    currentPage = null;
    window.location.hash = '#/dashboard';
  } catch (err) {
    showFormError(err.message);
  }
}

// ---------- pages ----------

async function renderDashboard() {
  defaultShell('<div class="page-title">Dashboard</div><div id="dash-content" class="panel"><p class="muted">Loading…</p></div>', 'dashboard');
  const host = $('#dash-content');
  try {
    const stats = await API.get('/api/dashboard');
    const hasRuns = Number(stats.run_count || 0) > 0;
    host.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-value">${Number(stats.workflow_count || 0)}</div>
          <div class="stat-label">Total Workflows</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Number(stats.run_count || 0)}</div>
          <div class="stat-label">Total Runs</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Number(stats.pending_approval_count || 0)}</div>
          <div class="stat-label">Pending Approvals</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${Number(stats.unread_notification_count || 0)}</div>
          <div class="stat-label">Notifications</div>
        </div>
      </div>
      <div class="dash-cols">
        <div class="dash-col">
          <div class="panel-heading">Recent runs</div>
          ${recentRunsTable(stats.recent_runs || [], hasRuns)}
        </div>
        <div class="dash-col">
          <div class="panel-heading">Workflows</div>
          ${(stats.recent_workflows || []).map((w) => `
            <div class="list-row">
              <a class="link" href="#/workflow/${encodeURIComponent(w.id)}">${esc(w.name)}</a>
              <span class="muted sm">${fmtAgo(w.updated_at)}</span>
            </div>`).join('') || '<p class="muted">No workflows yet — create one from a template.</p>'}
          <div class="panel-heading" style="margin-top:18px">Quick start</div>
          <a class="btn primary" href="#/templates" data-testid="browse-templates-btn">Browse templates</a>
        </div>
      </div>`;
  } catch (err) {
    host.innerHTML = `<p class="muted">Could not load dashboard: ${esc(err.message)}</p>`;
  }
}

function recentRunsTable(runs, hasRuns) {
  if (!runs.length) {
    return `<div class="panel empty-state" data-testid="dashboard-empty-state">
      <p class="muted">${hasRuns ? 'Recent runs will appear here.' : 'No runs yet. Trigger a workflow to see it here.'}</p>
      <a class="btn ghost sm" href="#/templates">Pick a template to start</a>
    </div>`;
  }
  return `<table class="table">
    <thead><tr><th>Run</th><th>Workflow</th><th>Status</th><th>Created</th></tr></thead>
    <tbody>${runs.map((r) => `
      <tr>
        <td><a class="link mono sm" href="#/run/${encodeURIComponent(r.id)}">${esc(String(r.id).slice(0, 8))}</a></td>
        <td>${esc(r.workflow_name)}</td>
        <td>${statusPill(r.status)}</td>
        <td class="muted">${fmtAgo(r.created_at)}</td>
      </tr>`).join('')}
    </tbody></table>`;
}

async function renderWorkflows() {
  defaultShell('<div class="page-title">Workflows</div><div id="wf-content" class="panel"><p class="muted">Loading…</p></div>', 'workflows');
  const host = $('#wf-content');
  try {
    const { rows } = await loadWorkflows();
    host.innerHTML = `
      <div class="toolbar">
        <span class="muted">${rows.length} workflow${rows.length === 1 ? '' : 's'}</span>
        <div>
          <a class="btn ghost sm" href="#/templates">Use a template</a>
          <a class="btn primary sm" href="#/workflows/new" data-testid="new-workflow-btn">+ New Workflow</a>
        </div>
      </div>
      ${rows.length ? `
      <table class="table">
        <thead><tr><th>Name</th><th>Summary</th><th>Version</th><th>Triggers</th><th>Runs</th><th>Updated</th><th></th></tr></thead>
        <tbody>${rows.map((w) => `
          <tr>
            <td><a class="link" href="#/workflow/${encodeURIComponent(w.id)}">${esc(w.name)}</a>${w.is_enabled === false ? ' <span class="pill pill-bad">disabled</span>' : ''}</td>
            <td class="muted">${esc(w.summary || '')}</td>
            <td class="mono sm">v${w.current_version ?? 1}</td>
            <td class="mono sm">${Number(w.trigger_count || 0)}</td>
            <td class="mono sm">${Number(w.run_count || 0)}</td>
            <td class="muted">${fmtAgo(w.updated_at)}</td>
            <td class="row-actions">
              <button class="btn ghost xs run-now" data-id="${esc(w.id)}" title="Run now">▶ Run</button>
              <a class="btn ghost xs" href="#/workflow-editor?edit=${encodeURIComponent(w.id)}">Edit</a>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="muted">No workflows. Start with a template or write your first manifest.</p>'}`;

    host.querySelectorAll('.run-now').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const res = await API.post(`/api/workflows/${btn.getAttribute('data-id')}/trigger`, {});
          showDemoBanner(`Run started · <a class="demo-run-link" href="#/run/${encodeURIComponent(res.run_id)}">${esc(String(res.run_id).slice(0, 8))}</a>`);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    host.innerHTML = `<p class="muted">Could not load workflows: ${esc(err.message)}</p>`;
  }
}

async function loadWorkflows() {
  const data = await API.get('/api/workflows?include_disabled=true&limit=500');
  const rows = data || [];
  return { rows, data };
}

function showDemoBanner(htmlContent) {
  let banner = $('#demo-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.className = 'demo-banner';
    banner.innerHTML = '<span class="demo-banner-text"></span><button class="demo-close">×</button>';
    document.body.appendChild(banner);
    banner.querySelector('.demo-close').addEventListener('click', () => banner.remove());
  }
  banner.querySelector('.demo-banner-text').innerHTML = htmlContent;
  banner.style.display = 'flex';
}

const DEFAULT_MANIFEST = `api_version: flowforge/v1
name: first-workflow
summary: My first workflow
triggers:
  - type: schedule
    cron: "0 9 * * *"
    timezone: UTC
steps:
  - id: say_hello
    type: log
    with:
      level: info
      message: "Hello from FlowForge"
`;

let templatesCache = null;

async function loadTemplates() {
  if (templatesCache) return templatesCache;
  templatesCache = await API.get('/api/templates');
  return templatesCache;
}

async function renderWorkflowEditor() {
  const { id } = parseHash();
  const editId = id || new URLSearchParams(window.location.hash.split('?')[1] || '').get('edit');
  let initial = { name: '', summary: '', manifest: DEFAULT_MANIFEST };
  if (editId) {
    try {
      const wf = await API.get(`/api/workflows/${editId}`);
      const manifestData = await API.get(`/api/workflows/${editId}/manifest`);
      initial = {
        name: wf.name,
        summary: wf.summary || '',
        manifest: manifestData.manifest_yaml || DEFAULT_MANIFEST,
      };
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  let templates = [];
  if (!editId) {
    try {
      templates = await loadTemplates();
    } catch {
      templates = [];
    }
  }

  defaultShell(`
    <div class="page-title">${editId ? 'Edit workflow' : 'New workflow'}</div>
    <div class="editor-layout">
      <div class="editor-side">
        <div class="panel">
          ${editId ? '' : `
          <label class="field">
            <span>Start from a template</span>
            <select id="new-workflow-template" data-testid="template-picker">
              <option value="">Blank workflow</option>
              ${templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}
            </select>
          </label>`}
          <label class="field">
            <span>Workflow name</span>
            <input id="wf-name" value="${esc(initial.name)}" placeholder="Invoice Chaser" />
          </label>
          <label class="field">
            <span>Summary</span>
            <input id="wf-summary" value="${esc(initial.summary)}" placeholder="What does this workflow do?" />
          </label>
          <button class="btn primary block" id="save-workflow">${editId ? 'Save changes' : 'Save workflow'}</button>
          ${editId ? '<p class="muted sm">Changing the manifest saves a new <b>draft version</b> — promote it on the workflow page to make it current.</p>' : ''}
          <a class="btn ghost block" href="#/workflows">Cancel</a>
        </div>
        <div class="panel">
          <div class="panel-heading">Validation</div>
          <button class="btn ghost sm block" id="validate-btn">Validate manifest</button>
          <div id="validate-output" class="muted sm"></div>
        </div>
      </div>
      <div class="editor-main">
        <div class="panel manifest-panel" id="manifest-panel">
          <div class="panel-heading">
            <span>workflow.yaml</span>
            <span class="muted sm">api_version flowforge/v1 · restricted expression language</span>
          </div>
          <textarea id="manifest-editor" spellcheck="false" wrap="off"></textarea>
        </div>
      </div>
    </div>`, 'workflows');

  const editor = $('#manifest-editor');
  editor.value = initial.manifest;

  const templateSelect = $('#new-workflow-template');
  if (templateSelect) {
    templateSelect.addEventListener('change', () => {
      const wanted = templateSelect.value;
      const tpl = (templates || []).find((t) => t.id === wanted);
      const nameInput = $('#wf-name');
      const summaryInput = $('#wf-summary');
      const panel = $('#manifest-panel');
      if (tpl) {
        editor.value = tpl.manifest;
        if (!nameInput.value.trim() || nameInput.value === DEFAULT_MANIFEST.split('\n')[1].replace('name: ', '')) {
          nameInput.value = tpl.name;
        }
        if (!summaryInput.value.trim()) summaryInput.value = tpl.summary || '';
        panel.setAttribute('data-template-id', tpl.id);
        panel.setAttribute('data-testid', `template-${tpl.id}`);
      } else {
        editor.value = DEFAULT_MANIFEST;
        panel.removeAttribute('data-template-id');
        panel.removeAttribute('data-testid');
      }
    });
  }

  $('#save-workflow').addEventListener('click', async () => {
    const name = $('#wf-name').value.trim();
    const summary = $('#wf-summary').value.trim();
    const manifest = editor.value;
    if (!name) { toast('Workflow name is required.', 'error'); return; }
    try {
      let draft = false;
      if (editId) {
        const manifestChanged = manifest !== initial.manifest;
        const payload = { name, summary, ...(manifestChanged ? { manifest } : {}) };
        const res = await API.put(`/api/workflows/${editId}`, payload);
        draft = Boolean(res && res.draft);
        toast(draft ? `Draft version v${res.version} saved — promote it to make it current.` : 'Workflow updated.', draft ? 'info' : 'ok');
        currentPage = null;
        window.location.hash = `#/workflow/${encodeURIComponent(editId)}`;
      } else {
        const res = await API.post('/api/workflows', { name, summary, manifest });
        toast(`Workflow created (v${res.version}).`, 'ok');
        currentPage = null;
        window.location.hash = '#/workflows';
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#validate-btn').addEventListener('click', async () => {
    const out = $('#validate-output');
    try {
      const res = await API.post('/api/workflows/validate', { manifest: editor.value });
      if (res.valid) {
        out.innerHTML = '<span class="ok-text">✓ Valid manifest' + (res.warnings && res.warnings.length ? ` (${res.warnings.length} warning${res.warnings.length === 1 ? '' : 's'})` : '') + '</span>';
      } else {
        out.innerHTML = '<span class="bad-text">✗ Invalid manifest</span><ul class="error-list">' +
          (res.errors || []).slice(0, 8).map((e) => `<li>${esc(e.code)}: ${esc(e.message)}</li>`).join('') + '</ul>';
      }
    } catch (err) {
      out.innerHTML = `<span class="bad-text">Validation request failed: ${esc(err.message)}</span>`;
    }
  });
}

async function renderWorkflowDetail() {
  const { id } = parseHash();
  defaultShell('<div class="page-title">Workflow</div><div id="wf-detail" class="panel"><p class="muted">Loading…</p></div>', 'workflows');
  const host = $('#wf-detail');
  let wf;
  try {
    wf = await API.get(`/api/workflows/${id}`);
  } catch (err) {
    host.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    return;
  }
  let manifest = { manifest_yaml: '' };
  let versions = [];
  let triggers = [];
  try {
    manifest = await API.get(`/api/workflows/${id}/manifest`);
    versions = await API.get(`/api/workflows/${id}/versions`);
    triggers = await API.get(`/api/workflows/${id}/triggers`);
  } catch { /* non-fatal */ }

  const newestDraft = (versions || []).filter((v) => !v.is_current).sort((a, b) => b.version_num - a.version_num)[0] || null;

  const triggerRows = (triggers || []).map((t) => {
    const cfg = (typeof t.config === 'string' ? JSON.parse(t.config || '{}') : (t.config || {}));
    let detail = t.type;
    if (t.type === 'schedule') detail += ` · ${cfg.cron || ''} ${cfg.timezone || ''}`;
    if (t.type === 'webhook') detail += ` · /hooks/slug/${t.path || ''}` + (t.auth_mode ? ` · ${t.auth_mode}` : '');
    return `<div class="list-row"><span class="mono sm">${esc(detail)}</span>${t.is_enabled === false ? ' <span class="pill pill-muted">disabled</span>' : ''}</div>`;
  }).join('') || '<p class="muted">No triggers.</p>';

  host.innerHTML = `
    <div class="detail-head">
      <div>
        <h1 class="detail-name">${esc(wf.name)}</h1>
        <p class="muted">${esc(wf.summary || 'No summary')}</p>
        <p class="mono sm muted">slug: ${esc(wf.slug || '')} · version v${wf.current_version ?? 1} · ${esc(wf.is_enabled === false ? 'disabled' : 'enabled')}</p>
      </div>
      <div class="detail-actions">
        <button class="btn primary" id="trigger-btn" data-testid="run-now-btn">▶ Run now</button>
        <a class="btn ghost" href="#/workflow-editor?edit=${encodeURIComponent(wf.id)}">Edit manifest</a>
        <button class="btn ghost" id="toggle-btn">${wf.is_enabled === false ? 'Enable' : 'Disable'}</button>
        <button class="btn danger-ghost" id="delete-btn">Delete</button>
      </div>
    </div>
    <div class="dash-cols">
      <div class="dash-col">
        <div class="panel-heading">Triggers</div>${triggerRows}
        <div class="panel-heading" style="margin-top:16px">Versions</div>
        ${(versions || []).map((v) => `<div class="list-row">
          <span class="mono sm">v${v.version_num}${v.is_current ? ' (current)' : (newestDraft && v.id === newestDraft.id ? ' · draft' : '')}</span>
          <span class="muted sm">${fmtAgo(v.created_at)}</span>
          ${v.is_current ? '' : `<button class="btn ghost xs promote-btn" data-testid="promote-btn" data-vid="${esc(v.id)}">Promote</button>`}
        </div>`).join('') || '<p class="muted">—</p>'}
      </div>
      <div class="dash-col">
        <div class="panel-heading">Manifest</div>
        <pre class="manifest-preview"><code>${esc((manifest && manifest.manifest_yaml) || '')}</code></pre>
      </div>
    </div>`;

  const triggerBtn = $('#trigger-btn');
  if (triggerBtn) {
    triggerBtn.addEventListener('click', async () => {
      triggerBtn.disabled = true;
      try {
        const res = await API.post(`/api/workflows/${id}/trigger`, {});
        showDemoBanner(`Run started · <a class="demo-run-link" href="#/run/${encodeURIComponent(res.run_id)}">view run</a>`);
        // Land on the live run inspector so status, timeline and approvals are
        // one place (§10.2).
        currentPage = null;
        window.location.hash = `#/run/${encodeURIComponent(res.run_id)}`;
      } catch (err) {
        toast(err.message, 'error');
        triggerBtn.disabled = false;
      }
    });
  }
  $('#toggle-btn').addEventListener('click', async () => {
    try {
      await API.put(`/api/workflows/${id}`, { is_enabled: wf.is_enabled !== false ? false : true });
      toast('Workflow updated.', 'ok');
      await renderWorkflowDetail();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#delete-btn').addEventListener('click', async () => {
    if (!window.confirm(`Delete workflow "${wf.name}"? Runs history is preserved.`)) return;
    try {
      await API.del(`/api/workflows/${id}`);
      toast('Workflow disabled.', 'ok');
      currentPage = null;
      window.location.hash = '#/workflows';
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  host.querySelectorAll('.promote-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await API.post(`/api/workflows/${id}/promote/${btn.getAttribute('data-vid')}`, {});
        toast('Version promoted. Triggers reconciled.', 'ok');
        await renderWorkflowDetail();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

async function renderRuns() {
  defaultShell('<div class="page-title">Runs</div><div id="runs-content" class="panel"><p class="muted">Loading…</p></div>', 'runs');
  const host = $('#runs-content');
  try {
    const rows = await API.get('/api/runs?limit=100');
    host.innerHTML = rows.length ? `
      <table class="table">
        <thead><tr><th>Run</th><th>Workflow</th><th>Status</th><th>Error</th><th>Created</th><th></th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td><a class="link mono sm" href="#/run/${encodeURIComponent(r.id)}">${esc(String(r.id).slice(0, 8))}</a></td>
            <td>${esc(r.workflow_name)}</td>
            <td>${statusPill(r.status)}</td>
            <td class="muted sm">${esc(r.error || '')}</td>
            <td class="muted">${fmtAgo(r.created_at)}</td>
            <td class="row-actions">
              ${['queued', 'running', 'waiting', 'paused'].includes(r.status) ? `<button class="btn ghost xs cancel-run" data-id="${esc(r.id)}">Cancel</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="muted">No runs yet.</p>';
    host.querySelectorAll('.cancel-run').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await API.post(`/api/runs/${btn.getAttribute('data-id')}/cancel`, {});
          toast('Run canceled.', 'ok');
          await renderRuns();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    host.innerHTML = `<p class="muted">Could not load runs: ${esc(err.message)}</p>`;
  }
}

const ACTIVE_RUN_STATUSES = ['queued', 'running', 'waiting', 'paused'];
const RUN_POLL_INTERVAL_MS = 1200;

let runPollTimer = null;

async function renderRunDetail() {
  const { id } = parseHash();
  clearRunPoll();

  async function load() {
    let run;
    try {
      run = await API.get(`/api/runs/${id}`);
    } catch (err) {
      $('#run-detail').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
      return null;
    }
    let steps = [];
    let approvals = [];
    try {
      steps = await API.get(`/api/runs/${id}/steps`);
      approvals = (await API.get('/api/approvals')) || [];
    } catch { /* non-fatal */ }
    approvals = (approvals || []).filter((a) => a.run_id === id);
    return { run, steps, approvals };
  }

  async function paint() {
    const data = await load();
    if (!data) return;
    const { run, steps, approvals } = data;

    const statusBadge = `<span class="status-pill status-pill-${esc(run.status)}" data-testid="run-status-${esc(run.status)}"><span class="status-dot"></span>${esc(STATUS_LABELS[run.status] || run.status)}</span>`;

    let approvalActions = '';
    if (run.status === 'paused' && approvals.length > 0) {
      approvalActions = approvals.map((a) => `
        <div class="panel approval-card">
          <div class="panel-heading">Approval needed</div>
          <p class="muted">${esc(a.prompt)}</p>
          <div class="approval-actions">
            <button class="btn primary sm" data-testid="approval-approve-btn" data-id="${esc(a.id)}">Approve</button>
            <button class="btn danger-ghost sm" data-testid="approval-reject-btn" data-id="${esc(a.id)}">Reject</button>
          </div>
        </div>`).join('');
    }

    const host = $('#run-detail');
    host.innerHTML = `
      <div class="detail-head">
        <div>
          <h1 class="detail-name mono">${esc(String(run.id).slice(0, 8))}</h1>
          <p class="muted">${esc(run.workflow_name)} · trigger ${esc(run.trigger_id || 'manual')}</p>
        </div>
        <div class="detail-actions">
          ${statusBadge}
          ${ACTIVE_RUN_STATUSES.includes(run.status) ? `<button class="btn ghost" id="run-cancel">Cancel</button>` : ''}
          <button class="btn ghost" id="run-refresh">↻ Refresh</button>
        </div>
      </div>
      ${approvalActions}
      <div class="stat-grid small">
        <div class="stat-card"><div class="stat-value">${esc(run.recovery_count ?? 0)}</div><div class="stat-label">Recoveries</div></div>
        <div class="stat-card"><div class="stat-value">${esc(run.total_running_seconds ?? 0)}s</div><div class="stat-label">Running seconds</div></div>
        <div class="stat-card"><div class="stat-value">${fmtAgo(run.created_at)}</div><div class="stat-label">Created</div></div>
        <div class="stat-card"><div class="stat-value">${fmtAgo(run.finished_at)}</div><div class="stat-label">Finished</div></div>
      </div>
      <div class="panel-heading" style="margin-top:14px">Steps</div>
      <div data-testid="run-inspector-timeline">
        ${steps.length ? `<table class="table">
          <thead><tr><th>Step</th><th>Path</th><th>Status</th><th>Iteration</th><th>Attempt</th><th>Started</th><th>Output</th></tr></thead>
          <tbody>${steps.map((s) => `
            <tr>
              <td class="mono sm">${esc(s.step_id)}</td>
              <td class="mono sm muted">${esc(s.step_path)}</td>
              <td>${statusPill(s.status)}</td>
              <td class="mono sm">${esc(s.iteration)}</td>
              <td class="mono sm">${esc(s.attempt)}</td>
              <td class="muted sm">${fmtAgo(s.started_at)}</td>
              <td class="mono sm output-cell">${esc(truncateJson(s.output))}</td>
            </tr>`).join('')}
          </tbody></table>` : '<p class="muted">No steps recorded yet.</p>'}
      </div>`;

    const cancelBtn = $('#run-cancel');
    if (cancelBtn && !cancelBtn.dataset.bound) {
      cancelBtn.dataset.bound = '1';
      cancelBtn.addEventListener('click', async () => {
        try {
          await API.post(`/api/runs/${id}/cancel`, {});
          toast('Run canceled.', 'ok');
          await paint();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
    const refreshBtn = $('#run-refresh');
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = '1';
      refreshBtn.addEventListener('click', () => paint());
    }
    host.querySelectorAll('[data-testid="approval-approve-btn"]').forEach((btn) => {
      btn.addEventListener('click', () => decideApproval(btn.getAttribute('data-id'), 'approve', paint));
    });
    host.querySelectorAll('[data-testid="approval-reject-btn"]').forEach((btn) => {
      btn.addEventListener('click', () => decideApproval(btn.getAttribute('data-id'), 'reject', paint));
    });

    // Live update while the run is not terminal (§D13 — polling is the
    // transport used by the static SPA; the API also exposes SSE).
    if (ACTIVE_RUN_STATUSES.includes(run.status)) {
      runPollTimer = setTimeout(paint, RUN_POLL_INTERVAL_MS);
    }
    return run;
  }

  defaultShell('<div class="page-title">Run</div><div id="run-detail" class="panel"><p class="muted">Loading…</p></div>', 'runs');
  await paint();
}

async function decideApproval(taskId, decision, repaint) {
  try {
    const res = await API.post(`/api/approvals/${taskId}/${decision}`, {});
    toast(`Approval ${decision === 'approve' ? 'approved' : 'rejected'} — run ${res.status}.`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
  clearRunPoll();
  if (typeof repaint === 'function') await repaint();
}

function clearRunPoll() {
  if (runPollTimer) {
    clearTimeout(runPollTimer);
    runPollTimer = null;
  }
}

function truncateJson(v) {
  if (v === null || v === undefined) return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 220 ? `${s.slice(0, 220)}…` : s;
}

async function renderApprovals() {
  defaultShell('<div class="page-title">Approvals</div><div id="approvals-content" class="panel"><p class="muted">Loading…</p></div>', 'approvals');
  const host = $('#approvals-content');
  try {
    const rows = await API.get('/api/approvals');
    host.innerHTML = rows.length ? `
      <p class="muted">Pending manual approvals. Decisions resume the paused run.</p>
      <table class="table">
        <thead><tr><th>Run</th><th>Workflow</th><th>Prompt</th><th>Created</th><th>Expires</th><th></th></tr></thead>
        <tbody>${rows.map((a) => `
          <tr>
            <td><a class="link mono sm" href="#/run/${encodeURIComponent(a.run_id)}">${esc(String(a.run_id).slice(0, 8))}</a></td>
            <td>${esc(a.workflow_name)}</td>
            <td>${esc(a.prompt)}</td>
            <td class="muted">${fmtAgo(a.created_at)}</td>
            <td class="muted">${fmtTime(a.timeout_at)}</td>
            <td class="row-actions">
              <button class="btn primary xs approve-btn" data-id="${esc(a.id)}">Approve</button>
              <button class="btn danger-ghost xs reject-btn" data-id="${esc(a.id)}">Reject</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>` : `
      <p class="muted">No pending approvals 🎉</p>
      <p class="muted sm">Manual approval steps (e.g. the Invoice Chaser escalation) park a run here until a human decides.</p>`;

    host.querySelectorAll('.approve-btn').forEach((btn) => {
      btn.addEventListener('click', () => decide(btn.getAttribute('data-id'), 'approve'));
    });
    host.querySelectorAll('.reject-btn').forEach((btn) => {
      btn.addEventListener('click', () => decide(btn.getAttribute('data-id'), 'reject'));
    });
  } catch (err) {
    host.innerHTML = `<p class="muted">Could not load approvals: ${esc(err.message)}</p>`;
  }

  async function decide(taskId, decision) {
    try {
      const res = await API.post(`/api/approvals/${taskId}/${decision}`, {});
      toast(`Approval ${decision}d — run ${res.status}.`, 'ok');
      await renderApprovals();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

async function renderTemplates() {
  defaultShell('<div class="page-title">Templates</div><div id="tpl-content" class="panel"><p class="muted">Loading…</p></div>', 'templates');
  const host = $('#tpl-content');
  try {
    const templates = await API.get('/api/templates');
    host.innerHTML = `
      <p class="muted">Five opinionated workflows for freelancers and micro-agencies. Pre-filled, validated, editable YAML.</p>
      <div class="tpl-grid">
        ${templates.map((t) => `
          <div class="tpl-card">
            <div class="tpl-head">
              <span class="tpl-icon">${esc(t.icon)}</span>
              <div>
                <div class="tpl-name">${esc(t.name)}</div>
                <div class="mono sm muted">${esc(t.id)}</div>
              </div>
            </div>
            <p class="tpl-summary">${esc(t.summary)}</p>
            <button class="btn primary block use-tpl" data-id="${esc(t.id)}" data-testid="template-use-${esc(t.id)}">Use this template</button>
          </div>`).join('')}
      </div>`;
    host.querySelectorAll('.use-tpl').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const res = await API.post('/api/workflows/from-template', { template_id: btn.getAttribute('data-id') });
          toast(`Created "${res.name}" (v${res.version}).`, 'ok');
          currentPage = null;
          window.location.hash = `#/workflow/${encodeURIComponent(res.id)}`;
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    host.innerHTML = `<p class="muted">Could not load templates: ${esc(err.message)}</p>`;
  }
}

async function renderAudit() {
  defaultShell('<div class="page-title">Audit Log</div><div id="audit-content" class="panel"><p class="muted">Loading…</p></div>', 'audit');
  const host = $('#audit-content');
  try {
    const rows = await API.get('/api/audit?limit=200');
    let verify = null;
    try {
      verify = await API.get('/api/audit/verify');
    } catch { /* non-fatal */ }
    host.innerHTML = `
      <div class="toolbar">
        <span class="muted">Append-only hash chain${verify ? ` · <span class="${verify.valid ? 'ok-text' : 'bad-text'}">${verify.valid ? '✓ chain valid' : '✗ chain broken at seq ' + verify.brokenAt}</span>` : ''}</span>
        <button class="btn ghost sm" id="verify-btn">Verify chain</button>
      </div>
      ${rows.length ? `
      <table class="table">
        <thead><tr><th>Seq</th><th>Action</th><th>Entity</th><th>Actor</th><th>Details</th><th>Time</th></tr></thead>
        <tbody>${rows.map((e) => `
          <tr>
            <td class="mono sm">${e.sequence_num}</td>
            <td class="mono sm">${esc(e.action)}</td>
            <td class="mono sm">${esc(e.entity_type)}:${esc(String(e.entity_id).slice(0, 12))}</td>
            <td class="mono sm muted">${esc(String(e.actor_id || 'system').slice(0, 12))}</td>
            <td class="mono sm muted">${esc(truncateJson(e.metadata))}</td>
            <td class="muted">${fmtTime(e.created_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="muted">No audit events yet.</p>'}`;
    $('#verify-btn').addEventListener('click', async () => {
      try {
        const v = await API.get('/api/audit/verify');
        toast(v.valid ? 'Audit chain verified.' : `Chain broken at sequence ${v.brokenAt}`, v.valid ? 'ok' : 'error');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  } catch (err) {
    host.innerHTML = `<p class="muted">Could not load audit log: ${esc(err.message)}</p>`;
  }
}

async function renderCredentials() {
  defaultShell('<div class="page-title">Credentials</div><div id="creds-content" class="panel"><p class="muted">Loading…</p></div>', 'credentials');
  const host = $('#creds-content');
  try {
    const rows = await API.get('/api/credentials');
    host.innerHTML = `
      <p class="muted">AES-256-GCM sealed values. Names only — values are never returned.</p>
      <div class="dash-cols">
        <div class="dash-col wide">
          ${rows.length ? `
          <table class="table">
            <thead><tr><th>Name</th><th>Type</th><th>Created</th><th></th></tr></thead>
            <tbody>${rows.map((c) => `
              <tr>
                <td class="mono sm">${esc(c.name)}</td>
                <td>${esc(c.type)}</td>
                <td class="muted">${fmtAgo(c.created_at)}</td>
                <td class="row-actions"><button class="btn danger-ghost xs del-cred" data-id="${esc(c.id)}">Delete</button></td>
              </tr>`).join('')}
            </tbody>
          </table>` : '<p class="muted">No credentials stored.</p>'}
        </div>
        <div class="dash-col">
          <div class="panel-heading">Add credential</div>
          <label class="field"><span>Name</span><input id="cred-name" placeholder="sendgrid_api_key" /></label>
          <label class="field"><span>Type</span>
            <select id="cred-type"><option value="bearer">Bearer token</option><option value="api_key">API key</option><option value="basic">Password</option></select>
          </label>
          <label class="field"><span>Value</span><input id="cred-value" type="password" /></label>
          <button class="btn primary block" id="cred-add">Store credential</button>
        </div>
      </div>`;
    host.querySelectorAll('.del-cred').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await API.del(`/api/credentials/${btn.getAttribute('data-id')}`);
          toast('Credential deleted.', 'ok');
          await renderCredentials();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
    $('#cred-add').addEventListener('click', async () => {
      const name = $('#cred-name').value.trim();
      const type = $('#cred-type').value;
      const value = $('#cred-value').value;
      if (!name || !value) { toast('Name and value are required.', 'error'); return; }
      try {
        await API.post('/api/credentials', { name, type, value });
        toast('Credential stored.', 'ok');
        await renderCredentials();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  } catch (err) {
    host.innerHTML = `<p class="muted">Could not load credentials: ${esc(err.message)}</p>`;
  }
}

async function renderMembers() {
  defaultShell('<div class="page-title">Members</div><div id="members-content" class="panel"><p class="muted">Loading…</p></div>', 'members');
  const host = $('#members-content');
  try {
    const rows = await API.get('/api/members');
    host.innerHTML = `
      <div class="dash-cols">
        <div class="dash-col wide">
          ${rows.length ? `
          <table class="table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr></thead>
            <tbody>${rows.map((m) => `
              <tr>
                <td>${esc(m.name)}</td>
                <td class="mono sm">${esc(m.email)}</td>
                <td>${esc(m.role)}${m.role === 'owner' ? ' 👑' : ''}</td>
                <td class="muted">${fmtAgo(m.created_at)}</td>
                <td class="row-actions">
                  ${App.role === 'owner' && m.role !== 'owner' ? `
                    <button class="btn ghost xs promote-btn-member" data-id="${esc(m.id)}">Make admin</button>
                    <button class="btn danger-ghost xs remove-member" data-id="${esc(m.id)}">Remove</button>` : ''}
                </td>
              </tr>`).join('')}
            </tbody>
          </table>` : '<p class="muted">No members.</p>'}
        </div>
        <div class="dash-col">
          <div class="panel-heading">Invite member</div>
          <label class="field"><span>Email</span><input id="invite-email" type="email" placeholder="teammate@example.com" /></label>
          <label class="field"><span>Role</span>
            <select id="invite-role"><option value="member">Member</option><option value="admin">Admin</option></select>
          </label>
          <button class="btn primary block" id="invite-btn">Send invitation</button>
          <p class="muted sm">Invitations expire after 7 days.</p>
        </div>
      </div>`;
    host.querySelectorAll('.remove-member').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Remove this member?')) return;
        try {
          await API.del(`/api/members/${btn.getAttribute('data-id')}`);
          toast('Member removed.', 'ok');
          await renderMembers();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
    host.querySelectorAll('.promote-btn-member').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await API.call('PATCH', `/api/members/${btn.getAttribute('data-id')}/role`, { role: 'admin' });
          toast('Role updated.', 'ok');
          await renderMembers();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
    $('#invite-btn').addEventListener('click', async () => {
      const email = $('#invite-email').value.trim();
      const role = $('#invite-role').value;
      if (!email) { toast('Email is required.', 'error'); return; }
      try {
        await API.post('/api/invitations', { email, role });
        toast(`Invitation sent to ${email}.`, 'ok');
        $('#invite-email').value = '';
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  } catch (err) {
    host.innerHTML = `<p class="muted">Could not load members: ${esc(err.message)}</p>`;
  }
}

async function renderNotifications() {
  defaultShell('<div class="page-title">Notifications</div><div id="notif-content" class="panel"><p class="muted">Loading…</p></div>', 'notifications');
  const host = $('#notif-content');
  try {
    const rows = await API.get('/api/notifications?limit=100');
    host.innerHTML = rows.length ? `
      <p class="muted">Generated by notify steps — inbox and outbound email (enqueue-only status per design).</p>
      <table class="table">
        <thead><tr><th></th><th>Channel</th><th>To</th><th>Subject</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>${rows.map((n) => `
          <tr class="${n.is_read ? '' : 'row-unread'}">
            <td>${n.is_read ? '' : '●'}</td>
            <td>${esc(n.channel)}</td>
            <td class="mono sm">${esc(n.recipient)}</td>
            <td>${esc(n.subject || '')}<div class="muted sm">${esc(truncateJson(n.body))}</div></td>
            <td>${esc(n.status)}</td>
            <td class="muted">${fmtAgo(n.created_at)}</td>
            <td class="row-actions">${n.is_read ? '' : `<button class="btn ghost xs mark-read" data-id="${esc(n.id)}">Mark read</button>`}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '<p class="muted">No notifications yet. Trigger the Invoice Chaser and watch them land here.</p>';
    host.querySelectorAll('.mark-read').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await API.post(`/api/notifications/${btn.getAttribute('data-id')}/read`, {});
          await renderNotifications();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    host.innerHTML = `<p class="muted">Could not load notifications: ${esc(err.message)}</p>`;
  }
}

async function renderSettings() {
  defaultShell(`
    <div class="page-title">Settings</div>
    <div class="dash-cols">
      <div class="dash-col">
        <div class="panel">
          <div class="panel-heading">Webhook secrets</div>
          <div id="secrets-list"><p class="muted">Loading…</p></div>
          <label class="field"><span>Name</span><input id="secret-name" placeholder="STRIPE_WEBHOOK" /></label>
          <label class="field"><span>Value</span><input id="secret-value" type="password" /></label>
          <button class="btn primary block" id="secret-add">Store secret</button>
        </div>
      </div>
      <div class="dash-col">
        <div class="panel">
          <div class="panel-heading">Egress allowlist</div>
          <div id="allowlist-list"><p class="muted">Loading…</p></div>
          <div class="allowlist-form-row">
            <label class="field"><span>Scheme</span><select id="al-scheme"><option>https</option><option>http</option></select></label>
            <label class="field"><span>Host</span><input id="al-host" placeholder="api.example.com" /></label>
            <label class="field"><span>Port</span><input id="al-port" type="number" placeholder="auto" /></label>
          </div>
          <button class="btn primary block" id="allowlist-add">Add entry</button>
        </div>
        <div class="panel">
          <div class="panel-heading">API tokens</div>
          <div id="tokens-list"><p class="muted">Loading…</p></div>
          <label class="field"><span>Token name</span><input id="token-name" placeholder="ci-deploy" /></label>
          <button class="btn primary block" id="token-add">Create token</button>
          <div id="token-reveal" class="muted sm mono"></div>
        </div>
      </div>
    </div>`, 'settings');

  try {
    const secrets = await API.get('/api/webhook-secrets');
    $('#secrets-list').innerHTML = secrets.length ? `
      <table class="table">
        <thead><tr><th>Name</th><th>Created</th><th></th></tr></thead>
        <tbody>${secrets.map((s) => `
          <tr><td class="mono sm">${esc(s.name)}</td><td class="muted">${fmtAgo(s.created_at)}</td>
          <td class="row-actions"><button class="btn danger-ghost xs del-secret" data-id="${esc(s.id)}">Delete</button></td></tr>`).join('')}
        </tbody>
      </table>` : '<p class="muted">No secrets stored.</p>';
    $('#secrets-list').querySelectorAll('.del-secret').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await API.del(`/api/webhook-secrets/${btn.getAttribute('data-id')}`);
          toast('Secret deleted.', 'ok');
          await renderSettings();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    $('#secrets-list').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }

  try {
    const entries = await API.get('/api/allowlist');
    $('#allowlist-list').innerHTML = entries.length ? `
      <table class="table">
        <thead><tr><th>Scheme</th><th>Host</th><th>Port</th><th></th></tr></thead>
        <tbody>${entries.map((a) => `
          <tr><td class="mono sm">${esc(a.scheme)}</td><td class="mono sm">${esc(a.host)}</td>
          <td class="mono sm">${a.port == null ? 'default' : esc(String(a.port))}</td>
          <td class="row-actions"><button class="btn danger-ghost xs del-al" data-id="${esc(a.id)}">Delete</button></td></tr>`).join('')}
        </tbody>
      </table>` : '<p class="muted">Empty — http steps can still reach the app URL and FF_HTTP_ALLOWLIST hosts.</p>';
    $('#allowlist-list').querySelectorAll('.del-al').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await API.del(`/api/allowlist/${btn.getAttribute('data-id')}`);
          toast('Allowlist entry deleted.', 'ok');
          await renderSettings();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    $('#allowlist-list').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }

  try {
    const tokens = await API.get('/api/api-tokens');
    $('#tokens-list').innerHTML = tokens.length ? `
      <table class="table">
        <thead><tr><th>Name</th><th>Created</th><th>Last used</th><th></th></tr></thead>
        <tbody>${tokens.map((t) => `
          <tr><td class="mono sm">${esc(t.name)}</td><td class="muted">${fmtAgo(t.created_at)}</td>
          <td class="muted">${t.revoked_at ? 'revoked' : (t.last_used_at ? fmtAgo(t.last_used_at) : 'never')}</td>
          <td class="row-actions">${t.revoked_at ? '' : `<button class="btn danger-ghost xs revoke-token" data-id="${esc(t.id)}">Revoke</button>`}</td></tr>`).join('')}
        </tbody>
      </table>` : '<p class="muted">No tokens created.</p>';
    $('#tokens-list').querySelectorAll('.revoke-token').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await API.del(`/api/api-tokens/${btn.getAttribute('data-id')}`);
          toast('Token revoked.', 'ok');
          await renderSettings();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    $('#tokens-list').innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }

  $('#secret-add').addEventListener('click', async () => {
    const name = $('#secret-name').value.trim();
    const value = $('#secret-value').value;
    if (!name || !value) { toast('Name and value are required.', 'error'); return; }
    try {
      await API.post('/api/webhook-secrets', { name, value });
      toast('Secret stored.', 'ok');
      await renderSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#allowlist-add').addEventListener('click', async () => {
    const scheme = $('#al-scheme').value;
    const host = $('#al-host').value.trim();
    const portRaw = $('#al-port').value.trim();
    const port = portRaw === '' ? undefined : parseInt(portRaw, 10);
    if (!host) { toast('Host is required.', 'error'); return; }
    try {
      await API.post('/api/allowlist', { scheme, host, port });
      toast('Allowlist entry added.', 'ok');
      await renderSettings();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#token-add').addEventListener('click', async () => {
    const name = $('#token-name').value.trim();
    if (!name) { toast('Token name is required.', 'error'); return; }
    try {
      const res = await API.post('/api/api-tokens', { name });
      $('#token-reveal').innerHTML = `Copy this token now — it is shown once:<br/><span class="ok-text">${esc(res.token)}</span>`;
      $('#tokens-list').querySelectorAll('table').forEach((t) => t.remove());
      const tokens = await API.get('/api/api-tokens');
      $('#tokens-list').innerHTML = tokens.length ? `
        <table class="table">
          <thead><tr><th>Name</th><th>Created</th><th></th></tr></thead>
          <tbody>${tokens.map((t) => `
            <tr><td class="mono sm">${esc(t.name)}</td><td class="muted">${fmtAgo(t.created_at)}</td>
            <td class="row-actions">${t.revoked_at ? '' : `<button class="btn danger-ghost xs revoke-token" data-id="${esc(t.id)}">Revoke</button>`}</td></tr>`).join('')}
          </tbody>
        </table>` : '<p class="muted">No tokens created.</p>';
      $('#tokens-list').querySelectorAll('.revoke-token').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await API.del(`/api/api-tokens/${btn.getAttribute('data-id')}`);
            toast('Token revoked.', 'ok');
            await renderSettings();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      });
      toast('Token created.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---------- command palette ----------

const PALETTE_ACTIONS = NAV_ITEMS.map(([key, label, icon]) => ({
  key,
  label,
  icon,
  run: () => {
    window.location.hash = `#/${key}`;
  },
}));

function openCommandPalette() {
  if (!App.user) return;
  if ($('#command-palette')) return;
  const overlay = document.createElement('div');
  overlay.id = 'command-palette';
  overlay.innerHTML = `
    <div class="palette-backdrop"></div>
    <div class="palette-dialog">
      <input id="command-palette-input" data-testid="command-palette-input" placeholder="Type a command…" autocomplete="off" />
      <div class="palette-list" id="palette-list"></div>
    </div>`;
  document.body.appendChild(overlay);
  const input = $('#command-palette-input');
  const list = $('#palette-list');

  const renderList = (query = '') => {
    const q = query.trim().toLowerCase();
    const items = PALETTE_ACTIONS.filter(
      (a) => !q || a.label.toLowerCase().includes(q) || a.key.toLowerCase().includes(q)
    );
    list.innerHTML = items.length
      ? items.map((a, i) => `
          <button class="palette-item ${i === 0 ? 'selected' : ''}" data-key="${esc(a.key)}" data-index="${i}">
            <span>${a.icon}</span><span>${esc(a.label)}</span><span class="muted sm mono">#/${esc(a.key)}</span>
          </button>`).join('')
      : '<p class="muted palette-empty">No matching commands.</p>';
    list.querySelectorAll('.palette-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = PALETTE_ACTIONS.find((a) => a.key === btn.getAttribute('data-key'));
        closeCommandPalette();
        if (action) action.run();
      });
    });
  };

  const close = () => {
    overlay.remove();
    window.removeEventListener('keydown', onKey, true);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const sel = list.querySelector('.palette-item.selected') || list.querySelector('.palette-item');
      if (sel) sel.click();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...list.querySelectorAll('.palette-item')];
      if (!items.length) return;
      const idx = items.findIndex((el) => el.classList.contains('selected'));
      const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items.forEach((el) => el.classList.remove('selected'));
      items[next].classList.add('selected');
      items[next].scrollIntoView({ block: 'nearest' });
      return;
    }
  };

  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('keydown', onKey);
  overlay.querySelector('.palette-backdrop').addEventListener('click', close);
  window.addEventListener('keydown', onKey, true);
  renderList('');
  input.focus();
}

function closeCommandPalette() {
  const overlay = $('#command-palette');
  if (overlay) overlay.remove();
}

// ---------- boot ----------

window.addEventListener('hashchange', () => {
  clearRunPoll();
  if (App.user) navigate().catch(() => {});
});

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    openCommandPalette();
  }
});

window.addEventListener('DOMContentLoaded', () => {
  document.title = 'FlowForge Open';
  boot().catch(() => renderAuth());
});
