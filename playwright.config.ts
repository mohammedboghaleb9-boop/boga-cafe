import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests on the real build (browser router, card payment off), served by
 * `vite preview`. In CI the browser comes from `npx playwright install`; locally,
 * PW_CHROMIUM can point to an already installed Chromium.
 */
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], locale: 'fr-FR', launchOptions: { executablePath } } }],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
