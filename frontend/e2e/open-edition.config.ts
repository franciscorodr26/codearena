import { defineConfig, devices } from '@playwright/test'

// Browser proof for the open edition against an already-running local stack:
//   backend  http://localhost:3201  (CODEARENA_RUNNER=local, CODEARENA_DEV_AUTO_LOGIN=1)
//   frontend http://localhost:3200  (NEXT_PUBLIC_BACKEND_URL=http://localhost:3201)
// Run from frontend/:  npx playwright test -c e2e/open-edition.config.ts
export default defineConfig({
  testDir: '.',
  testMatch: ['open-edition.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 180000,
  expect: { timeout: 20000 },
  outputDir: process.env.E2E_OUT || 'test-results/open-edition',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3200',
    trace: 'retain-on-failure',
    screenshot: 'off',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
