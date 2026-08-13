import { defineConfig } from '@playwright/test'

// The suite runs against the DEV server on purpose: the service worker's scope, module
// serving, and proxy wiring differ between vite dev and the production build, and the dev
// side is where a misregistered worker silently kills session renewal.
const STUB_PORT = 5198
const APP_PORT = 5199

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
  },
  webServer: [
    {
      command: 'node e2e/stub-server.mjs',
      port: STUB_PORT,
      env: { STUB_PORT: String(STUB_PORT) },
      reuseExistingServer: false,
    },
    {
      command: `npm run dev -- --port ${APP_PORT} --strictPort`,
      port: APP_PORT,
      env: { STREAMARR_API_TARGET: `http://localhost:${STUB_PORT}` },
      reuseExistingServer: false,
    },
  ],
})
