import { defineConfig, devices } from '@playwright/test'

// Browser journeys for the open edition. Starts its own dev servers.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['matchmaking-preferences.spec.ts'],
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:3197',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3197',
    url: 'http://127.0.0.1:3197',
    reuseExistingServer: false,
    timeout: 120000,
    env: { NEXT_PUBLIC_BACKEND_URL: 'http://127.0.0.1:3999' },
  },
})
