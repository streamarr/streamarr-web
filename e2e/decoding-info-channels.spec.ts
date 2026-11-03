import { expect, test } from '@playwright/test'
import {
  answersThatDependOnChannelCount,
  CHANNEL_COUNT_PROBE,
  recordDecodingInfo,
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
  await testInfo.attach('decoding-info-channel-counts.json', {
    body: JSON.stringify(record, null, 2),
    contentType: 'application/json',
  })

  expect(answersThatDependOnChannelCount(record.answers)).toEqual([])
  // FLAC carries at most 8 channels, so a supported answer at 32 shows that the count goes
  // unchecked. Without it, refusals at every count would also pass the comparison above.
  const flacAt32 = Object.values(record.answers.FLAC).map((byChannels) => byChannels['32'])
  expect(flacAt32).toContainEqual(expect.stringMatching(/^supported/))
})
