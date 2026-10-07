import { defineConfig, devices } from '@playwright/test'

const external = process.env.CODEARENA_DASHBOARD_BASE_URL

export default defineConfig({
  testDir: './e2e',
  testMatch: 'dashboard-layout.spec.ts',
  outputDir: 'test-results/dashboard',
  workers: 2,
  timeout: 45000,
  reporter: 'list',
  use: {
    baseURL: external || 'http://127.0.0.1:4417',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: external ? undefined : {
    command: 'npm start -- --hostname 127.0.0.1 --port 4417',
    url: 'http://127.0.0.1:4417',
    reuseExistingServer: false,
    timeout: 60000,
  },
})
