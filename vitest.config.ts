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
  },
})
