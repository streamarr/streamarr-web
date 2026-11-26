import { http, passthrough } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { server as requests } from '../src/test/server'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileAnswers, servePages, type PageServer } from './pageServer'

const SEGMENT = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])

describe('servePages', () => {
  let server: PageServer | undefined

  afterEach(async () => {
    await server?.close()
    server = undefined
  })

  async function serving(answers: Parameters<typeof servePages>[0]): Promise<string> {
    server = await servePages(answers)
    // The unit tests' request interceptor lets requests to the real dev server through.
    requests.use(http.all(`${server.origin}/*`, () => passthrough()))
    return server.origin
  }

  it('shouldAnswerAPreparedPathWithItsBodyAndContentTypeWhenTheRequestNamesIt', async () => {
    const origin = await serving(
      new Map([['/ladder/AAC/init.mp4', { contentType: 'video/mp4', body: SEGMENT }]]),
    )

    const response = await fetch(`${origin}/ladder/AAC/init.mp4?t=token`)

    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(SEGMENT)
  })

  it('shouldServeAPreparedPageWithItsOwnMarkupWhenTheRequestNamesIt', async () => {
    const origin = await serving(new Map([['/page', { html: '<title>Recorder</title><main>' }]]))

    const response = await fetch(`${origin}/page`)

    expect(response.headers.get('content-type')).toBe('text/html')
    expect(await response.text()).toContain('<title>Recorder</title><main>')
  })

  it('shouldNotServeAPreparedFileWhenTheRequestNamesItUnderAnotherPath', async () => {
    const origin = await serving(
      new Map([['/ladder/AAC/init.mp4', { contentType: 'video/mp4', body: SEGMENT }]]),
    )

    const response = await fetch(`${origin}/ladder/FLAC/init.mp4`)

    expect(response.headers.get('content-type')).not.toBe('video/mp4')
    expect(new Uint8Array(await response.arrayBuffer())).not.toEqual(SEGMENT)
  })
})

describe('fileAnswers', () => {
  it('shouldAnswerEachFileOfTheDirectoryUnderTheServedPathWhenTheDirectoryHoldsAStream', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'file-answers-'))
    try {
      await writeFile(join(directory, 'stream.m3u8'), '#EXTM3U\n')
      await writeFile(join(directory, 'init.mp4'), SEGMENT)

      const answers = new Map(await fileAnswers('/safari-hdr/HLG', directory))

      expect(answers).toEqual(
        new Map([
          [
            '/safari-hdr/HLG/stream.m3u8',
            {
              contentType: 'application/vnd.apple.mpegurl',
              body: Buffer.from('#EXTM3U\n'),
            },
          ],
          ['/safari-hdr/HLG/init.mp4', { contentType: 'video/mp4', body: Buffer.from(SEGMENT) }],
        ]),
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
