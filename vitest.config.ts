import { defineConfig } from 'vitest/config'

// Only the session-renewal core is gated; the rest of src/ is reported, not enforced.
const renewalCoreThresholds = { statements: 95, branches: 95, functions: 95, lines: 95 }

export default defineConfig({
  test: {
    // Unit tests only: the Playwright specs under e2e/ run through their own runner.
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'https://streamarr.test/',
      },
    },
    // Globals are what let @testing-library/react register its afterEach cleanup automatically.
    globals: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/**',
        'src/graphql/generated/**',
        'src/api/generated/**',
        'src/routeTree.gen.ts',
        'src/main.tsx',
        'src/sw/sw.ts',
        'src/auth/renewal-worker.ts',
      ],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        perFile: true,
        'src/auth/renewal{Bridge,Protocol,Scheduler,SharedWorker}.ts': renewalCoreThresholds,
        'src/sw/{decisions,sessionRenewal,worker}.ts': renewalCoreThresholds,
      },
    },
  },
})
