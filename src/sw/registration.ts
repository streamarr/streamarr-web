// Pure decision logic for registering the session service worker, imported by main.tsx and
// unit-tested here.

export interface ServiceWorkerRegistrationSpec {
  scriptUrl: string
  options: RegistrationOptions
}

/** Vite serves the TypeScript module entry in dev; the build emits /sw.js at the origin root. */
export function decideRegistration(dev: boolean): ServiceWorkerRegistrationSpec {
  return {
    scriptUrl: dev ? '/src/sw/sw.ts' : '/sw.js',
    options: { type: 'module' },
  }
}
