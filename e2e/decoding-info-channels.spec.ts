import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import {
  answersThatDependOnChannelCount,
  CHANNEL_COUNT_PROBE,
  recordDecodingInfo,
  supportedFlacAnswersAboveItsLimit,
} from './decodingInfoChannels'

// The capability declaration takes an audio codec's channel maximum from decodingInfo's answers at
// 6 and 2 channels (streamarr/streamarr-server#395). This spec records whether each engine's answer
// depends on the channel count. When an engine starts to refuse counts it cannot play, this spec
// fails, and the declaration's channel maximum needs another look.

test('decodingInfo answers each audio codec the same at every channel count', async ({
  page,
}, testInfo) => {
  // The page is blank and stays on the app's origin. No app code runs.
  await page.route('**/decoding-info', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>decodingInfo</title>' }),
  )
  await page.goto('/decoding-info')

  const record = await page.evaluate(recordDecodingInfo, CHANNEL_COUNT_PROBE)
  // The file stays in test-results after the run, whichever reporter ran.
  const recording = testInfo.outputPath('decoding-info-channel-counts.json')
  await writeFile(recording, JSON.stringify(record, null, 2))
  await testInfo.attach('decoding-info-channel-counts.json', {
    path: recording,
    contentType: 'application/json',
  })

  expect(
    answersThatDependOnChannelCount(record.answers),
    'answers that change with the channel count',
  ).toEqual([])
  expect(
    supportedFlacAnswersAboveItsLimit(record.answers),
    'FLAC answered supported above its 8-channel limit',
  ).not.toEqual([])
})
