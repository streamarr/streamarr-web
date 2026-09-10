import { describe, expect, it } from 'vitest'
import { nextPlayableEpisode } from './nextPlayableEpisode'

function episode(
  number: number,
  overrides: { watchStatus?: 'UNWATCHED' | 'IN_PROGRESS' | 'WATCHED'; positionSeconds?: number; fileId?: string | null } = {},
) {
  return {
    id: `e${number}`,
    episodeNumber: number,
    watchStatus: overrides.watchStatus ?? 'UNWATCHED',
    watchProgress: overrides.positionSeconds != null ? { positionSeconds: overrides.positionSeconds } : null,
    files: overrides.fileId === null ? [] : [{ id: overrides.fileId ?? `file-e${number}` }],
  }
}

describe('nextPlayableEpisode', () => {
  it('resumes an in-progress episode ahead of any earlier unwatched one', () => {
    const playable = nextPlayableEpisode([
      { seasonNumber: 1, episodes: [episode(1), episode(2, { watchStatus: 'IN_PROGRESS', positionSeconds: 600 })] },
    ])
    expect(playable).toEqual({
      id: 'e2',
      seasonNumber: 1,
      episodeNumber: 2,
      fileId: 'file-e2',
      positionSeconds: 600,
      verb: 'Resume',
    })
  })

  it('continues with the first unwatched episode once something has been watched', () => {
    const playable = nextPlayableEpisode([
      { seasonNumber: 1, episodes: [episode(1, { watchStatus: 'WATCHED' }), episode(2)] },
    ])
    expect(playable).toMatchObject({ id: 'e2', verb: 'Continue', positionSeconds: null })
  })

  it('plays the first episode of a series nothing has been watched in', () => {
    const playable = nextPlayableEpisode([{ seasonNumber: 1, episodes: [episode(1), episode(2)] }])
    expect(playable).toMatchObject({ id: 'e1', verb: 'Play' })
  })

  it('starts over from the first episode when everything is watched', () => {
    const playable = nextPlayableEpisode([
      { seasonNumber: 1, episodes: [episode(1, { watchStatus: 'WATCHED' }), episode(2, { watchStatus: 'WATCHED' })] },
    ])
    expect(playable).toMatchObject({ id: 'e1', verb: 'Play' })
  })

  it('walks seasons and episodes in number order regardless of list order', () => {
    const playable = nextPlayableEpisode([
      { seasonNumber: 2, episodes: [episode(1)] },
      { seasonNumber: 1, episodes: [episode(2), episode(1, { watchStatus: 'WATCHED' })] },
    ])
    expect(playable).toMatchObject({ seasonNumber: 1, episodeNumber: 2, verb: 'Continue' })
  })

  it('skips null entries the schema allows and yields null with no episodes at all', () => {
    expect(nextPlayableEpisode([null, { seasonNumber: 1, episodes: [null] }])).toBeNull()
    expect(nextPlayableEpisode([])).toBeNull()
  })

  it('carries a null file id when the episode has no media file', () => {
    const playable = nextPlayableEpisode([{ seasonNumber: 1, episodes: [episode(1, { fileId: null })] }])
    expect(playable?.fileId).toBeNull()
  })
})
