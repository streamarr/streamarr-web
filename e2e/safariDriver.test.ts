import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../src/test/server'
import { withSafari } from './safariDriver'

const DRIVER = 'http://localhost:4444'

// A safaridriver that opens session s-1 and records each command it receives.
function fakeDriver(): string[] {
  const commands: string[] = []
  server.use(
    http.post(`${DRIVER}/session`, () =>
      HttpResponse.json({
        value: { sessionId: 's-1', capabilities: { browserVersion: '26.6.2' } },
      }),
    ),
    http.all(`${DRIVER}/session/s-1/*`, ({ request }) => {
      commands.push(`${request.method} ${new URL(request.url).pathname}`)
      return HttpResponse.json({ value: null })
    }),
  )
  return commands
}

describe('withSafari', () => {
  it('shouldCloseTheSessionsWindowWhenTheRecordingEnds', async () => {
    const commands = fakeDriver()

    const version = await withSafari(1_000, async (safari) => {
      await safari.open('http://127.0.0.1/page')
      return safari.browserVersion
    })

    expect(version).toBe('26.6.2')
    expect(commands).toEqual(['POST /session/s-1/url', 'DELETE /session/s-1/window'])
  })

  it('shouldCloseTheSessionsWindowWhenTheRecordingFails', async () => {
    const commands = fakeDriver()

    await expect(
      withSafari(1_000, () => Promise.reject(new Error('The page never answered'))),
    ).rejects.toThrow('The page never answered')

    expect(commands).toEqual(['DELETE /session/s-1/window'])
  })
})
