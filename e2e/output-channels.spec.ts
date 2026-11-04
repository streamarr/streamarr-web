import { expect, test, type Page } from '@playwright/test'
import type { ClientCapabilityDeclarationInput } from '../src/graphql/generated/graphql'
import { CHANNEL_COUNT_PROBE, recordDecodingInfo } from './decodingInfoChannels'

// Each playback session builds a new declaration, and each declaration reads the output's channel
// count through an AudioContext. On the Linux CI runner, WebKit's web process crashed on the next
// media call after a page read maxChannelCount, so the declaration skips that read there. This spec
// builds declarations around decodingInfo questions in one page, in every engine. It never retries,
// so a crash fails it.

test.describe.configure({ retries: 0 })

type Capabilities = typeof import('../src/streaming/playbackCapabilities')

// Vite's dev server serves the module that the player imports.
const CAPABILITIES_MODULE = '/src/streaming/playbackCapabilities.ts'

function declare(page: Page): Promise<ClientCapabilityDeclarationInput> {
  return page.evaluate(async (path) => {
    const capabilities = (await import(/* @vite-ignore */ path)) as Capabilities
    const video = document.createElement('video')
    return capabilities.declarePlaybackCapabilities(capabilities.browserPlaybackPlatform(video))
  }, CAPABILITIES_MODULE)
}

function readOutputChannels(page: Page): Promise<number> {
  return page.evaluate(async (path) => {
    const capabilities = (await import(/* @vite-ignore */ path)) as Capabilities
    return capabilities
      .browserPlaybackPlatform(document.createElement('video'))
      .audioOutputChannels()
  }, CAPABILITIES_MODULE)
}

test('declarations cap each audio entry at the output after decodingInfo questions in the same page', async ({
  page,
}, testInfo) => {
  await page.route('**/output-channels', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Output channels</title>',
    }),
  )
  await page.goto('/output-channels')

  const first = await declare(page)
  await page.evaluate(recordDecodingInfo, CHANNEL_COUNT_PROBE)
  const second = await declare(page)
  const third = await declare(page)
  const outputChannels = await readOutputChannels(page)

  await testInfo.attach('output-channels.json', {
    body: JSON.stringify({ outputChannels, audio: first.audio }, null, 2),
    contentType: 'application/json',
  })
  // A host without an audio device reports 0 channels. No entry declares more than 5.1.
  const declared = Math.min(Math.max(outputChannels, 2), 6)
  const aac = first.audio.find((entry) => entry.codec === 'AAC')
  expect(aac?.maxChannels).toBe(declared)
  expect(Math.max(...first.audio.map((entry) => entry.maxChannels))).toBe(declared)
  expect(second).toEqual(first)
  expect(third).toEqual(first)
})
