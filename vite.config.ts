import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

// Dev-only: point the proxy at a server that is not on this machine, e.g. a box on the LAN.
//   STREAMARR_API_TARGET=http://10.0.0.5:8080 npm run dev
const apiTarget = process.env.STREAMARR_API_TARGET ?? 'http://localhost:8080'

// Both workers build as stable origin-root entries. The service worker's /sw.js location gives it
// whole-app scope; in dev Vite serves the module entries from /src/, so the worker's root scope
// is only reachable because the dev server sends Service-Worker-Allowed below.
export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
  server: {
    headers: {
      'Service-Worker-Allowed': '/',
    },
    proxy: {
      '/graphql': apiTarget,
      '/api': apiTarget,
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        renewal: path.resolve(import.meta.dirname, 'src/auth/renewal-worker.ts'),
        sw: path.resolve(import.meta.dirname, 'src/sw/sw.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'sw') return 'sw.js'
          if (chunk.name === 'renewal') return 'renewal-worker.js'
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },
})
