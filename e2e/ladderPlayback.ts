import type { APIRequestContext, Page, Request } from '@playwright/test'
import { STUB_URL } from './ports'

/** The path of the playback session's stream: its multivariant playlist and its variants. */
export const LADDER_STREAM_PATH = '/api/stream/ladder/'

export interface LadderPlayback {
  choice: string
  transcodeMode: string
}

function playbackSession({ choice, transcodeMode }: LadderPlayback) {
  return {
    id: 'playback-1',
    formatAttemptCount: 1,
    maximumFormatAttempts: 4,
    requestedChoice: choice,
    playbackChoice: choice,
    formatChange: null,
    offeredChoices: ['ORIGINAL', 'AUTO', 'HIGH_720P', 'MEDIUM_480P', 'LOW_360P'],
    currentFormatAttempt: {
      __typename: 'ReadyPlaybackFormatAttempt',
      streamSession: {
        __typename: 'HlsStreamSession',
        id: 'sess-1',
        streamUrl: `${LADDER_STREAM_PATH}multivariant.m3u8?t=playback-token`,
        transcodeMode,
        videoRange: 'SDR',
        mediaEndSeconds: null,
      },
    },
  }
}

function operationName(call: Request): string {
  const body = call.postDataJSON() as { operationName?: string } | null
  return body?.operationName ?? ''
}

/**
 * Signs the page in and answers the player's GraphQL operations for one playback session of the
 * movie m1, whose stream lies under LADDER_STREAM_PATH. Returns each playback-session mutation the
 * player sends, in order, as it sends them; reads of the session's status are left out.
 */
export async function routeLadderPlayback(
  page: Page,
  request: APIRequestContext,
  playback: LadderPlayback,
): Promise<string[]> {
  const mutations: string[] = []
  await request.post(`${STUB_URL}/__test/mode`, { data: { mode: 'renewable' } })
  await request.post(`${STUB_URL}/api/auth/refresh`)
  const operations: Record<string, unknown> = {
    CreatePlaybackSession: {
      createPlaybackSession: { playbackSession: playbackSession(playback), userErrors: [] },
    },
    PlaybackSession: { playbackSession: playbackSession(playback) },
    PlayerMediaTitle: { movie: { __typename: 'Movie', id: 'm1', title: 'Everlight' } },
    ReportStreamSessionTimeline: { reportStreamSessionTimeline: true },
    DestroyPlaybackSession: {
      destroyPlaybackSession: { playbackSessionId: 'playback-1', userErrors: [] },
    },
  }
  await page.route('**/graphql', async (route) => {
    const name = operationName(route.request())
    if (name.includes('Playback') && name !== 'PlaybackSession') mutations.push(name)
    const data = operations[name]
    return data ? route.fulfill({ json: { data } }) : route.continue()
  })
  return mutations
}
