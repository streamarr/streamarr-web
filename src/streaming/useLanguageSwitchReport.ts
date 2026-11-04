import type { ApolloClient } from '@apollo/client'
import { useApolloClient } from '@apollo/client/react'
import {
  PlayerWiderSubtitleModeDocument,
  SetLanguageOverrideDocument,
  type SetLanguageOverrideInput,
  type SubtitleMode,
} from '../graphql/generated/graphql'
import { languageOfTrack } from '../languages/languages'
import type { ChosenTrack } from './PlayerControls'
import type { PlayableMediaTitle } from './usePlayerTitle'

type OverrideChange = Omit<SetLanguageOverrideInput, 'itemId'>

/**
 * Stores each audio or subtitle switch in the player as the Profile's override for the episode or
 * movie playing, never for its season or series, so resuming it keeps the switch and the next
 * episode starts from the wider levels (ADR 0043). A track that names no language of the server's
 * table stores nothing.
 */
export function useLanguageSwitchReport(
  mediaTitle: PlayableMediaTitle | undefined,
): (chosen: ChosenTrack) => void {
  const client = useApolloClient()
  return (chosen) => {
    if (!mediaTitle) {
      return
    }
    // The switch already plays; a failure to store it only means a resume starts from the wider
    // levels, which is what playback did before the switch.
    void storeSwitch({ client, mediaTitle, chosen }).catch(() => undefined)
  }
}

async function storeSwitch({
  client,
  mediaTitle,
  chosen,
}: {
  client: ApolloClient
  mediaTitle: PlayableMediaTitle
  chosen: ChosenTrack
}) {
  const change = await overrideChange({ client, mediaTitle, chosen })
  if (!change) {
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
}: {
  client: ApolloClient
  mediaTitle: PlayableMediaTitle
  chosen: ChosenTrack
}): Promise<OverrideChange | undefined> {
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
// Unread, it counts as the default, FORCED.
async function widerSubtitleMode(
  client: ApolloClient,
  { kind, id }: PlayableMediaTitle,
): Promise<SubtitleMode | undefined> {
  try {
    const { data } = await client.query({
      query: PlayerWiderSubtitleModeDocument,
      variables: { id, movie: kind === 'movie' },
      fetchPolicy: 'network-only',
    })
    if (kind === 'movie') {
      return data?.me.languagePreferences?.subtitleMode
    }
    return data?.episode?.season.languagePreference.subtitleMode
  } catch {
    return undefined
  }
}
