import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 120_000 },
  fullyParallel: false,
  retries: 2,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3123',
    headless: true,
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
