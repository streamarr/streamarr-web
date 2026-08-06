import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'https://streamarr.test/',
      },
    },
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/auth/renewalBridge.ts',
        'src/auth/renewalProtocol.ts',
        'src/auth/renewalScheduler.ts',
        'src/auth/renewalSharedWorker.ts',
        'src/sw/decisions.ts',
        'src/sw/sessionRenewal.ts',
        'src/sw/worker.ts',
      ],
      reporter: ['text', 'json-summary'],
      thresholds: {
        perFile: true,
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
})
