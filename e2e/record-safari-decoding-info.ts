// Records real Safari's decodingInfo answers on a Mac. CI runs Playwright's WebKit build instead,
// which is not Safari. Allow remote automation once with `safaridriver --enable`, then run:
//   safaridriver -p 4444 &
//   node e2e/record-safari-decoding-info.ts
// SAFARIDRIVER_URL names another driver address. The exit status is 1 whenever the spec would fail.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  answersThatDependOnChannelCount,
  CHANNEL_COUNT_PROBE,
  recordDecodingInfo,
  supportedFlacAnswersAboveItsLimit,
  type ChannelCountRecord,
} from './decodingInfoChannels.ts'
import { withSafari } from './safariDriver.ts'

const IGNORES_THE_COUNT = 'Safari answers each audio codec the same at every channel count.'

// Mirrors the spec's two expectations.
function verdict(record: ChannelCountRecord): string {
  const dependent = answersThatDependOnChannelCount(record.answers)
  if (dependent.length > 0) {
    return `Safari's answer depends on the channel count:\n${dependent.join('\n')}`
  }
  if (supportedFlacAnswersAboveItsLimit(record.answers).length === 0) {
    return 'Inconclusive: Safari answered no FLAC configuration above 8 channels supported.'
  }
  return IGNORES_THE_COUNT
}

// Safari opens a blank page that this script serves on the loopback address.
const server = createServer((_, response) => {
  response.setHeader('content-type', 'text/html')
  response.end('<!doctype html><title>decodingInfo</title>')
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
// The pending driver commands keep the process alive while Safari loads the page. The server
// alone never does, so a failed command still ends the run.
server.unref()
const { port } = server.address() as AddressInfo

// A page that never loads, or a probe that never answers, fails the run after 30 seconds.
await withSafari(30_000, async (safari) => {
  await safari.open(`http://127.0.0.1:${port}/`)
  const record = await safari.executeAsync<ChannelCountRecord>(
    `const done = arguments[arguments.length - 1];
      (${recordDecodingInfo.toString()})(arguments[0]).then(done)`,
    [CHANNEL_COUNT_PROBE],
  )
  console.log(JSON.stringify(record, null, 2))
  const outcome = verdict(record)
  console.log(outcome)
  process.exitCode = outcome === IGNORES_THE_COUNT ? 0 : 1
})
