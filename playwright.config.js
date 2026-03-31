import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 2,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:3123',
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'npx serve . -l 3123 --no-clipboard',
    port: 3123,
    reuseExistingServer: !process.env.CI,
  },
});
