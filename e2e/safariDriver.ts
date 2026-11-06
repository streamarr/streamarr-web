// A minimal WebDriver client for safaridriver, which the record-safari-* scripts drive on a Mac.
// Allow remote automation once with `safaridriver --enable`, then start `safaridriver -p 4444`.
// SAFARIDRIVER_URL names another driver address.

const DRIVER = process.env.SAFARIDRIVER_URL ?? 'http://localhost:4444'

async function command<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${DRIVER}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const { value } = (await response.json()) as { value: T }
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${JSON.stringify(value)}`)
  }
  return value
}

/** One Safari window under automation. */
export interface SafariSession {
  /** Safari's version, as the driver reports it. */
  browserVersion: string
  open: (url: string) => Promise<void>
  /** Clicks the first element that matches `selector`, as a user's click. */
  click: (selector: string) => Promise<void>
  /** Runs `script` with `args`; its last argument is the callback that settles the result. */
  executeAsync: <T>(script: string, args?: unknown[]) => Promise<T>
}

/**
 * Opens a Safari window, hands it to `run`, and closes it whatever `run` does. A page that never
 * loads, or a script that never settles, fails after `timeoutMs`.
 */
export async function withSafari<T>(
  timeoutMs: number,
  run: (session: SafariSession) => Promise<T>,
): Promise<T> {
  const { sessionId, capabilities } = await command<{
    sessionId: string
    capabilities: { browserVersion: string }
  }>('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'safari',
        timeouts: { pageLoad: timeoutMs, script: timeoutMs },
      },
    },
  })
  const session: SafariSession = {
    browserVersion: capabilities.browserVersion,
    open: async (url) => {
      await command('POST', `/session/${sessionId}/url`, { url })
    },
    click: async (selector) => {
      const element = await command<Record<string, string>>(
        'POST',
        `/session/${sessionId}/element`,
        { using: 'css selector', value: selector },
      )
      await command('POST', `/session/${sessionId}/element/${Object.values(element)[0]}/click`)
    },
    executeAsync: (script, args = []) =>
      command('POST', `/session/${sessionId}/execute/async`, { script, args }),
  }
  try {
    return await run(session)
  } finally {
    await command('DELETE', `/session/${sessionId}`)
  }
}
