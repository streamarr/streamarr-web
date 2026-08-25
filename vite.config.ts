import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

// Dev proxy target, e.g. STREAMARR_API_TARGET=http://10.0.0.5:8080 npm run dev
const apiTarget = process.env.STREAMARR_API_TARGET ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      // Colocated route tests are not routes; without this the generator rescans on each one,
      // rewriting routeTree.gen.ts and reload-looping the page.
      routeFileIgnorePattern: '\\.test\\.(ts|tsx)$',
    }),
    react(),
  ],
  server: {
    // Every scan rewrites routeTree.gen.ts (same bytes, fresh mtime); watching it reload-loops.
    watch: {
      ignored: ['**/routeTree.gen.ts'],
    },
    // The dev worker entry lives under /src/, so root scope needs this header.
    headers: {
      'Service-Worker-Allowed': '/',
    },
    proxy: {
      '/graphql': apiTarget,
      '/api': apiTarget,
    },
  },
  // Both workers build as stable origin-root entries; /sw.js gives the service worker whole-app
  // scope.
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
