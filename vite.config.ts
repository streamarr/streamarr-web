import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

// The service worker builds as its own entry served from the origin root (/sw.js) so its scope
// covers the whole app; in dev Vite serves the module entry from /src/sw/, so root scope is
// only reachable because the dev server sends Service-Worker-Allowed below.
export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
  server: {
    headers: {
      'Service-Worker-Allowed': '/',
    },
    proxy: {
      '/graphql': 'http://localhost:8080',
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        sw: path.resolve(import.meta.dirname, 'src/sw/sw.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
})
