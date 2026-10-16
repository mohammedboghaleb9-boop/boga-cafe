import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests on `npm run build:e2e`: the real site's settings (browser router,
 * card payment off) with the demo data (.env.e2e), served by `vite preview`; and the
 * live-site build (.env.e2e-supabase) for the Turnstile forms and the admin sign-in, whose
 * Supabase and Turnstile the tests answer themselves (e2e/live.ts); and the production build, the
 * "coming soon" page (e2e/coming-soon.spec.ts). In CI the browser comes from `npx playwright install`; locally,
 * PW_CHROMIUM can point to an already installed Chromium.
 */
const LIVE_BUILD = /(turnstile|admin-live)\.spec\.ts$/;
const COMING_SOON = /coming-soon\.spec\.ts$/;
const executablePath = process.env.PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // French unless a test says otherwise (the team's messages are in French)
    locale: 'fr-FR',
    trace: 'retain-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'chromium', testIgnore: [LIVE_BUILD, COMING_SOON], use: { ...devices['Desktop Chrome'], locale: 'fr-FR', launchOptions: { executablePath } } },
    {
      name: 'live-build',
      testMatch: LIVE_BUILD,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4174', locale: 'fr-FR', launchOptions: { executablePath } },
    },
    {
      name: 'coming-soon',
      testMatch: COMING_SOON,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4175', locale: 'fr-FR', launchOptions: { executablePath } },
    },
  ],
  webServer: [
    {
      // bind the address the tests use: on CI "localhost" can resolve to IPv6 (::1) only
      command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npx vite preview --outDir dist-e2e-supabase --host 127.0.0.1 --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npx vite preview --outDir dist-coming-soon --host 127.0.0.1 --port 4175 --strictPort',
      url: 'http://127.0.0.1:4175',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
