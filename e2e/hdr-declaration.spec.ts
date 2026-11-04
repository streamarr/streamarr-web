import { expect, test, type Page } from '@playwright/test'
import type {
  ClientCapabilityDeclarationInput,
  VideoCapabilityEntryInput,
} from '../src/graphql/generated/graphql'

// The unit tests answer the declaration's HDR questions with fakes, which accept any dictionary
// value. This spec asks each engine the real questions on a display that reports HDR, so a value
// that an engine rejects fails here. It never retries, so a crash fails it too.

test.describe.configure({ retries: 0 })

type Capabilities = typeof import('../src/streaming/playbackCapabilities')

// Vite's dev server serves the module that the player imports.
const CAPABILITIES_MODULE = '/src/streaming/playbackCapabilities.ts'

interface HdrDeclaration {
  declaration: ClientCapabilityDeclarationInput
  /** Each HDR question the engine rejected, with its codec string, transfer and reason. */
  rejections: string[]
  /** Each HDR question's answer, keyed by its codec string, transfer and picture. */
  answers: Record<string, string>
}

function declareOnDisplay(page: Page, highDynamicRange: boolean): Promise<HdrDeclaration> {
  return page.evaluate(
    async ({ path, highDynamicRange }) => {
      const capabilities = (await import(/* @vite-ignore */ path)) as Capabilities
      const matchMedia = window.matchMedia.bind(window)
      const decodingInfo = navigator.mediaCapabilities.decodingInfo.bind(
        navigator.mediaCapabilities,
      )
      const rejections: string[] = []
      const answers: Record<string, string> = {}
      window.matchMedia = (query) => {
        if (query.includes('dynamic-range')) {
          return { ...matchMedia(query), matches: highDynamicRange }
        }
        return matchMedia(query)
      }
      navigator.mediaCapabilities.decodingInfo = async (configuration) => {
        const video = configuration.video
        const question = [
          video?.contentType,
          video?.transferFunction ?? 'no transfer',
          `${video?.width}x${video?.height}@${video?.framerate}`,
        ].join(' ')
        const isHdrQuestion =
          video?.transferFunction !== undefined ||
          /codecs="(dvh1|dav1)/.test(video?.contentType ?? '')
        try {
          const answer = await decodingInfo(configuration)
          if (isHdrQuestion) {
            answers[question] = answer.supported ? 'supported' : 'unsupported'
          }
          return answer
        } catch (error) {
          if (isHdrQuestion) {
            rejections.push(`${question}: ${String(error)}`)
          }
          throw error
        }
      }
      try {
        const video = document.createElement('video')
        const declaration = await capabilities.declarePlaybackCapabilities(
          capabilities.browserPlaybackPlatform(video),
        )
        return { declaration, rejections, answers }
      } finally {
        window.matchMedia = matchMedia
        navigator.mediaCapabilities.decodingInfo = decodingInfo
      }
    },
    { path: CAPABILITIES_MODULE, highDynamicRange },
  )
}

function isSdrEntry(entry: VideoCapabilityEntryInput): boolean {
  return entry.compatibleBases.length === 1 && entry.compatibleBases[0] === 'SDR'
}

test('an HDR display adds HDR entries beside unchanged SDR entries, and the engine answers every HDR question', async ({
  page,
}, testInfo) => {
  await page.route('**/hdr-declaration', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>HDR declaration</title>',
    }),
  )
  await page.goto('/hdr-declaration')

  const sdrDisplay = await declareOnDisplay(page, false)
  const hdrDisplay = await declareOnDisplay(page, true)

  await testInfo.attach('hdr-declaration.json', {
    body: JSON.stringify(
      { answers: hdrDisplay.answers, video: hdrDisplay.declaration.video },
      null,
      2,
    ),
    contentType: 'application/json',
  })
  expect(sdrDisplay.answers).toEqual({})
  expect(hdrDisplay.rejections).toEqual([])
  expect(Object.keys(hdrDisplay.answers).length).toBeGreaterThan(0)
  expect(hdrDisplay.declaration.video.filter(isSdrEntry)).toEqual(sdrDisplay.declaration.video)
  expect(hdrDisplay.declaration.audio).toEqual(sdrDisplay.declaration.audio)
  // Each HDR entry follows the 10-bit SDR entry whose maximums it keeps.
  hdrDisplay.declaration.video.forEach((entry, index) => {
    if (isSdrEntry(entry)) {
      return
    }
    const sdrEntry = hdrDisplay.declaration.video[index - 1]
    expect(sdrEntry.maxBitDepth).toBe(10)
    expect({ ...entry, compatibleBases: ['SDR'], dolbyVisionProfiles: [] }).toEqual(sdrEntry)
    expect(entry.hdr10Plus).toBe(false)
  })
})
