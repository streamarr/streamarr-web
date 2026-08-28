export interface ServiceWorkerRegistrationSpec {
  scriptUrl: string
  options: RegistrationOptions
}

/**
 * Scope must be explicit: the default is the script's directory, and the dev entry under /src/sw/
 * could never control an app page (the dev server sends Service-Worker-Allowed to permit '/').
 */
export function decideRegistration(dev: boolean): ServiceWorkerRegistrationSpec {
  return {
    scriptUrl: dev ? '/src/sw/sw.ts' : '/sw.js',
    options: { type: 'module', scope: '/' },
  }
}
