import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against the production build.
 * Locally:  npm run build && npm run test:e2e   (starts `vite preview` automatically)
 * Against any URL (e.g. a preview deploy): E2E_BASE_URL=https://… npm run test:e2e
 */
const externalBaseUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: externalBaseUrl ?? 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: externalBaseUrl
    ? undefined
    : { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
