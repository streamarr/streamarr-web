// Records real Safari's decodingInfo answers on a Mac. CI runs Playwright's WebKit build instead,
// which is not Safari. Allow remote automation once with `safaridriver --enable`, then run:
//   safaridriver -p 4444 &
//   node e2e/record-safari-decoding-info.ts
// SAFARIDRIVER_URL names another driver address. The exit status is 1 when an answer depends on the
// channel count, as the spec's comparison fails.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  answersThatDependOnChannelCount,
  CHANNEL_COUNT_PROBE,
  recordDecodingInfo,
  type ChannelCountRecord,
} from './decodingInfoChannels.ts'

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

// Safari opens a blank page that this script serves on the loopback address.
const server = createServer((_, response) => {
  response.setHeader('content-type', 'text/html')
  response.end('<!doctype html><title>decodingInfo</title>')
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address() as AddressInfo

const { sessionId } = await command<{ sessionId: string }>('POST', '/session', {
  capabilities: { alwaysMatch: { browserName: 'safari' } },
})
try {
  await command('POST', `/session/${sessionId}/url`, { url: `http://127.0.0.1:${port}/` })
  const record = await command<ChannelCountRecord>('POST', `/session/${sessionId}/execute/async`, {
    script: `const done = arguments[arguments.length - 1];
      (${recordDecodingInfo.toString()})(arguments[0]).then(done)`,
    args: [CHANNEL_COUNT_PROBE],
  })
  console.log(JSON.stringify(record, null, 2))
  const dependent = answersThatDependOnChannelCount(record.answers)
  console.log(
    dependent.length === 0
      ? 'Safari answers each audio codec the same at every channel count.'
      : `Safari's answer depends on the channel count:\n${dependent.join('\n')}`,
  )
  process.exitCode = dependent.length === 0 ? 0 : 1
} finally {
  await command('DELETE', `/session/${sessionId}`)
  server.close()
}
