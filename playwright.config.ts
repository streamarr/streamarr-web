import { defineConfig, devices } from '@playwright/test'
import { APP_PORT, STUB_PORT, STUB_URL } from './e2e/ports'

// Runs against vite dev on purpose: service-worker scope and proxy wiring differ from the build.
const baseURL = `http://localhost:${APP_PORT}`

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }], ['list']] : 'list',
  fullyParallel: false,
  // The stub's mode is process-global, so specs cannot run concurrently.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'stub-api',
      command: 'node e2e/stub-server.mjs',
      port: STUB_PORT,
      env: { STUB_PORT: String(STUB_PORT) },
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 120_000,
    },
    {
      name: 'vite-dev',
      command: `npm run dev -- --port ${APP_PORT} --strictPort`,
      url: baseURL,
      env: { STREAMARR_API_TARGET: STUB_URL },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
