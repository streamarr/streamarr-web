import type { ApolloClient } from '@apollo/client'
import { useApolloClient } from '@apollo/client/react'
import {
  PlayerSubtitleModesDocument,
  SetLanguageOverrideDocument,
  type SetLanguageOverrideInput,
  type SubtitleMode,
} from '../graphql/generated/graphql'
import { languageOfTrack } from '../languages/languages'
import type { ChosenTrack } from './PlayerControls'
import type { PlayableMediaTitle } from './usePlayerTitle'

type OverrideChange = Omit<SetLanguageOverrideInput, 'itemId'>

interface StoreRequest {
  client: ApolloClient
  mediaTitle: PlayableMediaTitle
  chosen: ChosenTrack
  /** False once the store was reset or cleared for another Profile or account. */
  isCurrent: () => boolean
}

/**
 * Stores each audio or subtitle switch in the player as the Profile's override for the episode or
 * movie playing, never for its season or series, so resuming it keeps the switch and the next
 * episode starts from the wider levels (ADR 0043). Switches store one at a time, in the order the
 * viewer made them. A track that names no language of the server's table stores nothing, and so
 * do an audio switch that playback never moved to and a switch still waiting when the store resets
 * for another Profile or account.
 */
export function useLanguageSwitchReport(
  mediaTitle: PlayableMediaTitle | undefined,
): (chosen: ChosenTrack) => void {
  const client = useApolloClient()

  return (chosen) => {
    if (!mediaTitle) {
      return
    }
    // Fenced from the pick until its store settles, even after the player closes.
    const fence = resetFence(client)
    // The switch already plays; a failure to store it only means a resume starts from the wider
    // levels, which is what playback did before the switch.
    const queue = queueOf(client)
    queue.last = queue.last
      .then(() => storeSwitch({ client, mediaTitle, chosen, isCurrent: fence.isCurrent }))
      .catch(() => undefined)
      .finally(fence.stop)
  }
}

// One queue per client rather than per player, so a player opened again stores after the switches
// that the one before it still had waiting. A reset or clear starts a new queue for the next
// identity, so a store of the earlier one that never answers holds back none of its switches.
const queuesByClient = new WeakMap<ApolloClient, { last: Promise<void> }>()

function queueOf(client: ApolloClient): { last: Promise<void> } {
  const existing = queuesByClient.get(client)
  if (existing) {
    return existing
  }
  const queue = { last: Promise.resolve() }
  const restart = () => {
    queue.last = Promise.resolve()
    return Promise.resolve()
  }
  client.onResetStore(restart)
  client.onClearStore(restart)
  queuesByClient.set(client, queue)
  return queue
}

// Whether the store has been reset or cleared, as a Profile or account switch does, since now.
function resetFence(client: ApolloClient): { isCurrent: () => boolean; stop: () => void } {
  let current = true
  const outdate = () => {
    current = false
    return Promise.resolve()
  }
  const stopOnReset = client.onResetStore(outdate)
  const stopOnClear = client.onClearStore(outdate)
  return {
    isCurrent: () => current,
    stop: () => {
      stopOnReset()
      stopOnClear()
    },
  }
}

async function storeSwitch(request: StoreRequest) {
  const { client, mediaTitle, chosen, isCurrent } = request
  if (chosen.kind === 'audio' && !(await chosen.moved)) {
    return
  }
  const change = await overrideChange(request)
  if (!change || !isCurrent()) {
    return
  }
  await client.mutate({
    mutation: SetLanguageOverrideDocument,
    variables: { input: { itemId: mediaTitle.id, ...change } },
  })
}

async function overrideChange({
  client,
  mediaTitle,
  chosen,
}: StoreRequest): Promise<OverrideChange | undefined> {
  switch (chosen.kind) {
    case 'audio': {
      const language = languageOfTrack(chosen.language)
      return language && { audioLanguage: language }
    }
    case 'subtitles': {
      const language = languageOfTrack(chosen.language)
      return language && { subtitleLanguage: language, subtitleMode: 'ALWAYS' }
    }
    case 'subtitles-off': {
      const wider = await widerSubtitleMode(client, mediaTitle)
      return { subtitleMode: wider === 'OFF' ? 'OFF' : 'FORCED' }
    }
  }
}

// The mode the episode or movie gets without its own override: its season's, else the Profile's.
// A read that fails rejects, so the switch stores nothing rather than guess.
async function widerSubtitleMode(
  client: ApolloClient,
  { kind, id }: PlayableMediaTitle,
): Promise<SubtitleMode | undefined> {
  const { data } = await client.query({
    query: PlayerSubtitleModesDocument,
    variables: { id, movie: kind === 'movie' },
    fetchPolicy: 'network-only',
  })
  if (kind === 'movie') {
    return data?.me.languagePreferences?.subtitleMode
  }
  return data?.episode?.season.languagePreference.subtitleMode
}
