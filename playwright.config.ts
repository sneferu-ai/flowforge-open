import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: process.env.FF_APP_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_NO_SERVER ? undefined : {
    // The single-process entrypoint performs its own initialization
    // (migrations + plans + system jobs, demo with FF_SEED_DEMO).
    command: 'node apps/server/dist/index.js',
    url: 'http://localhost:3000/healthz',
    timeout: 40000,
    reuseExistingServer: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      FF_PORT: '3000',
      FF_APP_URL: 'http://localhost:3000',
      FF_SEED_DEMO: 'true',
      FF_DEMO_EMAIL: 'demo@acme.test',
      FF_DEMO_PASSWORD: 'demo-pass-2026',
    } as Record<string, string>,
  },
});
