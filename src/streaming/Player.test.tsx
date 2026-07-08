import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, graphql } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { Player } from './Player'

const hls = vi.hoisted(() => ({
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
  supported: true,
}))

vi.mock('hls.js', () => ({
  default: class {
    static isSupported() {
      return hls.supported
    }
    loadSource = hls.loadSource
    attachMedia = hls.attachMedia
    destroy = hls.destroy
    on = hls.on
  },
}))

const STREAM_URL = '/api/stream/abcd/master.m3u8?t=playback-token'
const SESSION = { id: 'sess-1', streamUrl: STREAM_URL, transcodeMode: 'REMUX' }

describe('Player', () => {
  it('shouldCreateSessionAndFeedTokenedUrlToHls', async () => {
    let variables: unknown
    server.use(
      graphql.mutation('CreateStreamSession', ({ variables: v }) => {
        variables = v
        return HttpResponse.json({ data: { createStreamSession: SESSION } })
      }),
    )

    renderWithProviders(<Player mediaFileId="abcd" />)

    // The playlist URL — carrying the playback ?t= token — is what hls.js loads; segment
    // requests spawned from it inherit the token.
    await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(STREAM_URL))
    expect(hls.attachMedia).toHaveBeenCalledOnce()
    expect(variables).toEqual({ mediaFileId: 'abcd' })
  })

  it('shouldShowErrorWhenSessionCreationFails', async () => {
    server.use(
      graphql.mutation('CreateStreamSession', () =>
        HttpResponse.json({ errors: [{ message: 'boom' }] }, { status: 200 }),
      ),
    )

    renderWithProviders(<Player mediaFileId="abcd" />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
