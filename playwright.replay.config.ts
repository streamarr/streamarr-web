import { defineConfig, devices } from '@playwright/test'
import base from './playwright.config'
import { APP_PORT } from './e2e/ports'

// Replays recorded-shape live traffic to measure throughput; run on demand, never in CI:
// npx playwright test -c playwright.replay.config.ts
// REPLAY_BUILD=1 measures the production bundle instead of the dev server.
const [stub, dev] = Array.isArray(base.webServer) ? base.webServer : []
const app = process.env.REPLAY_BUILD
  ? { ...dev, command: `npm run build && npx vite preview --port ${APP_PORT} --strictPort` }
  : dev

export default defineConfig({
  ...base,
  testDir: './e2e/replay',
  testMatch: '**/*.replay.ts',
  retries: 0,
  reporter: 'list',
  webServer: [stub, { ...app, timeout: 300_000 }],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
