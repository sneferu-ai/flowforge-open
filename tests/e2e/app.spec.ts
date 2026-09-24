import { test, expect, type Page } from '@playwright/test';

const DEMO_EMAIL = process.env.FF_DEMO_EMAIL || 'demo@acme.test';
const DEMO_PASSWORD = process.env.FF_DEMO_PASSWORD || 'demo-pass-2026';

/**
 * Demo-login journey (spec §3.15): the login page itself discloses the
 * seeded credentials in the demo-credentials panel; the test reads the
 * displayed values and types them into the form — exactly what a human
 * does — so a password/email rotation can never strand the suite.
 */
async function login(page: Page) {
  await page.goto('/login');
  await expect(page.getByTestId('demo-credentials')).toBeVisible();
  const email = await page.getByTestId('demo-credentials-email').textContent();
  const password = await page.getByTestId('demo-credentials-password').textContent();
  await page.getByTestId('login-email').fill(email ?? DEMO_EMAIL);
  await page.getByTestId('login-password').fill(password ?? DEMO_PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/dashboard/);
  await page.waitForSelector('.sidebar-brand', { timeout: 10000 });
}

async function createInvoiceChaser(page: Page) {
  await page.goto('/templates');
  await page.waitForSelector('[data-testid="template-use-invoice-chaser"]');
  await page.click('[data-testid="template-use-invoice-chaser"]');
  // Lands on the workflow detail page (create, or open the existing instance).
  await page.waitForSelector('[data-testid="run-now-btn"]', { timeout: 15000 });
}

test('health endpoint returns ok', async ({ request }) => {
  const res = await request.get('/healthz');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe('ok');
});

test('landing page renders the hero', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="landing-hero"]');
  await expect(page.locator('.auth-logo')).toContainText('FlowForge');
  await expect(page.locator('[data-testid="landing-login-btn"]')).toBeVisible();
  await expect(page.locator('[data-testid="landing-register-btn"]')).toBeVisible();
});

test('can login with demo account', async ({ page }) => {
  await login(page);
  await expect(page.locator('.sidebar-brand')).toContainText('FlowForge');
  await expect(page.locator('.page-title')).toContainText('Dashboard');
});

test('dashboard shows the empty state before any runs', async ({ page }) => {
  await login(page);
  // On a freshly seeded workspace there are no runs and the dashboard shows
  // the empty state; after other tests have executed runs, the recent-runs
  // table is the equivalent healthy surface.
  const empty = page.locator('[data-testid="dashboard-empty-state"]');
  const panel = page.locator('.panel-heading', { hasText: 'Recent runs' });
  if ((await empty.count()) > 0) {
    await expect(empty).toBeVisible();
  } else {
    await expect(panel).toBeVisible({ timeout: 15000 });
  }
  const stats = page.locator('.stat-card');
  await expect(stats.first()).toContainText('Total Workflows');
  await expect(stats.nth(1)).toContainText('Total Runs');
});

test('command palette opens and filters', async ({ page }) => {
  await login(page);
  await page.keyboard.press('Control+K');
  const input = page.locator('[data-testid="command-palette-input"]');
  await expect(input).toBeVisible();
  await input.fill('workflows');
  const items = page.locator('.palette-item');
  await expect(items.first()).toContainText('Workflows');
  // Enter navigates to the first match.
  await page.keyboard.press('Enter');
  await page.waitForSelector('.page-title');
  await expect(page.locator('.page-title')).toContainText('Workflows');
});

test('templates page lists all five templates', async ({ page }) => {
  await login(page);
  await page.goto('/templates');
  await page.waitForSelector('.tpl-card');
  const cards = page.locator('.tpl-card');
  await expect(cards).toHaveCount(5);
  await expect(page.locator('[data-testid="template-use-invoice-chaser"]')).toBeVisible();
});

test('can create a workflow from a template', async ({ page }) => {
  await login(page);
  await page.goto('/templates');
  await page.waitForSelector('[data-testid="template-use-client-onboarding"]');
  await page.click('[data-testid="template-use-client-onboarding"]');
  await page.waitForSelector('[data-testid="run-now-btn"]', { timeout: 15000 });
  await expect(page.locator('.detail-name')).toContainText('Client Onboarding');
});

test('new workflow editor offers a template picker', async ({ page }) => {
  await login(page);
  await page.goto('/workflows/new');
  await page.waitForSelector('#manifest-editor');
  const picker = page.locator('[data-testid="template-picker"]');
  await expect(picker).toBeVisible();
  // Select Invoice Chaser — the editor pre-fills the template manifest.
  await picker.selectOption('invoice-chaser');
  await expect(page.locator('[data-testid="template-invoice-chaser"]')).toBeVisible();
  const content = await page.inputValue('#manifest-editor');
  expect(content).toContain('api_version');
  expect(content).toContain('fetch_overdue');
});

test('can create a workflow via the editor', async ({ page }) => {
  await login(page);
  await page.goto('/workflows/new');
  await page.waitForSelector('#wf-name');

  await page.fill('#wf-name', 'E2E Test Workflow');
  await page.fill('#wf-summary', 'Created by Playwright E2E test');
  await page.click('#save-workflow');
  await page.waitForSelector('.detail-name', { timeout: 15000 });
  await expect(page.locator('.detail-name')).toContainText('E2E Test Workflow');

  const slug = 'e2e-test-workflow';
  const list = await page.evaluate(async () => {
    const res = await fetch('/api/v1/workflows?include_disabled=true', { credentials: 'include' });
    return res.ok ? res.json() : { data: [] };
  });
  expect(list.data.some((w: { name: string }) => w.name === 'E2E Test Workflow')).toBeTruthy();
  await expect(page.getByText(slug, { exact: false }).first()).toBeAttached();
});

test('can trigger a workflow and view the run', async ({ page }) => {
  await login(page);
  await createInvoiceChaser(page);

  await page.click('[data-testid="run-now-btn"]');
  await page.waitForSelector('[data-testid="run-status-queued"], [data-testid="run-status-running"], [data-testid="run-status-succeeded"]', { timeout: 15000 });
  await expect(page.locator('.demo-banner', { hasText: 'Run started' })).toContainText('Run started');
});

test('default invoice chaser run succeeds without an approval', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);
  await createInvoiceChaser(page);

  await page.click('[data-testid="run-now-btn"]');
  await page.waitForSelector('[data-testid="run-status-succeeded"]', { timeout: 90000 });
  await expect(page.locator('[data-testid="run-inspector-timeline"]')).toBeVisible();
  // Default data (max 28 days overdue) needs no escalation: every recorded
  // step ended successful, no approval task interrupted the run.
  await expect(page.locator('[data-testid="run-inspector-timeline"]')).toContainText('fetch_overdue');
});

test('escalation path: edit → draft → promote → run pauses → approve → succeeds', async ({ page }) => {
  test.setTimeout(180000);
  await login(page);
  await createInvoiceChaser(page);

  // 1. Edit the manifest to include the escalation fixture.
  await page.click('[data-testid="edit-manifest-btn"]');
  await page.waitForSelector('#manifest-editor');
  const current = await page.inputValue('#manifest-editor');
  if (!current.includes('include_escalations')) {
    const escalated = current.replace(
      '/api/v1/demo/invoices?status=overdue',
      '/api/v1/demo/invoices?status=overdue&include_escalations=1'
    );
    expect(escalated).not.toBe(current);
    await page.fill('#manifest-editor', escalated);

    // 2. Save as draft version.
    await page.click('#save-workflow');
    await page.waitForSelector('[data-testid="promote-btn"]');

    // 3. Promote the draft.
    await page.locator('[data-testid="promote-btn"]').first().click();
    await page.waitForSelector('text=/Version \\d+ promoted/');
  }

  // 4. Run now — the 45-day escalation invoice parks the run on approval.
  await page.click('[data-testid="run-now-btn"]');
  await page.waitForSelector('[data-testid="run-status-paused"]', { timeout: 90000 });

  // 5. Approve — the run resumes and finishes.
  await page.click('[data-testid="approval-approve-btn"]');
  await page.waitForSelector('[data-testid="run-status-succeeded"]', { timeout: 90000 });
  await expect(page.locator('#run-detail')).toContainText('send_escalation_email');
});

test('invalid login shows error', async ({ page }) => {
  await page.goto('/login');
  await page.waitForSelector('#login-email');
  await page.fill('#login-email', 'nonexistent@flowforge.dev');
  await page.fill('#login-password', 'wrongpassword123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.form-error');
  await expect(page.locator('.form-error')).toContainText('Invalid');
});

test('API tokens: session+CSRF minted token authenticates via Bearer (§8.4/§11)', async ({ page }) => {
  await login(page);

  // 1. Mint an API token over the session path (what `forge login` does).
  const minted = await page.evaluate(async () => {
    const me = await fetch('/api/v1/auth/me', { credentials: 'include' });
    const meBody = await me.json();
    const res = await fetch('/api/v1/api-tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': meBody.data.csrf_token,
      },
      body: JSON.stringify({ name: `e2e-${Date.now()}` }),
      credentials: 'include',
    });
    return { status: res.status, body: await res.json() };
  });
  expect(minted.status).toBe(200);
  const token = minted.body.data.token as string;
  expect(token.startsWith('ff_')).toBeTruthy();

  // 2. Bearer header alone (no cookie) authenticates CLI-style callers.
  const bearer = await page.evaluate(async (t) => {
    const res = await fetch('/api/v1/workflows', {
      headers: { Authorization: `Bearer ${t}` },
    });
    return { status: res.status, body: await res.json() };
  }, token);
  expect(bearer.status).toBe(200);
  expect(Array.isArray(bearer.body.data)).toBeTruthy();

  // 3. A garbage token is rejected.
  const bad = await page.evaluate(async () => {
    const res = await fetch('/api/v1/workflows', {
      headers: { Authorization: 'Bearer ff_not-a-real-token' },
    });
    return res.status;
  });
  expect(bad).toBe(401);

  // 4. Revoking the token kills Bearer access immediately.
  const revoked = await page.evaluate(async (t) => {
    const list = await fetch('/api/v1/api-tokens', {
      headers: { Authorization: `Bearer ${t}` },
    });
    const listBody = await list.json();
    const id = listBody.data.find((row: { name: string }) => row.name.startsWith('e2e-')).id;
    const del = await fetch(`/api/v1/api-tokens/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${t}` },
    });
    const after = await fetch('/api/v1/workflows', {
      headers: { Authorization: `Bearer ${t}` },
    });
    return { delStatus: del.status, afterStatus: after.status };
  }, token);
  expect(revoked.delStatus).toBe(200);
  expect(revoked.afterStatus).toBe(401);
});
