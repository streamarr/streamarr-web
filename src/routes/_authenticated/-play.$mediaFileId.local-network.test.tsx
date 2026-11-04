// @vitest-environment-options {"url": "https://nas.local/"}
import { act, cleanup, waitFor } from '@testing-library/react'
import { HttpResponse, graphql } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreatePlaybackSessionInput } from '../../graphql/generated/graphql'
import { hls } from '../../test/fakeHls'
import { meFixture } from '../../test/meFixture'
import { destroyedPlaybackSession, readyPlaybackSession } from '../../test/playbackSession'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

vi.mock('hls.js', async () => (await import('../../test/fakeHls')).hlsModule)

const STREAM_URL = '/api/stream/file-1/multivariant.m3u8?t=playback-token'

describe('/play/$mediaFileId on the local network', () => {
  afterEach(async () => {
    await act(async () => cleanup())
  })

  it('shouldAttestTheLocalNetworkWhenThePageReachedTheServerByALocalName', async () => {
    const created: CreatePlaybackSessionInput[] = []
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({ data: { me: meFixture({ scope: 'profile' }) } }),
      ),
      graphql.mutation('CreatePlaybackSession', ({ variables }) => {
        created.push((variables as { input: CreatePlaybackSessionInput }).input)
        return HttpResponse.json({
          data: {
            createPlaybackSession: {
              playbackSession: readyPlaybackSession({
                streamSession: { id: 'sess-1', streamUrl: STREAM_URL, transcodeMode: 'REMUX' },
              }),
              userErrors: [],
            },
          },
        })
      }),
      graphql.mutation('DestroyPlaybackSession', ({ variables }) =>
        HttpResponse.json({
          data: { destroyPlaybackSession: destroyedPlaybackSession(variables) },
        }),
      ),
    )

    renderAppAt('/play/file-1')
    await waitFor(() => expect(hls.loadSource).toHaveBeenCalledWith(STREAM_URL))

    expect(window.location.hostname).toBe('nas.local')
    expect(created.map((input) => input.networkRoute)).toEqual(['LOCAL_NETWORK'])
  })
})
