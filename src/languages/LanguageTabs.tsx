import { useMutation, useQuery } from '@apollo/client/react'
import { Loader } from '@mantine/core'
import { useId, useRef, useState, type RefObject } from 'react'
import {
  LanguageTabsDocument,
  SetLanguageOverrideDocument,
  type Language,
  type LanguagePreferenceFieldsFragment,
  type LanguageTabsQuery,
  type PreferenceSource,
  type SetLanguageOverrideInput,
  type SubtitleMode,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage } from '../graphql/userErrors'
import { CaretPopover, type PopoverOption } from '../ui/CaretPopover'
import { FailureRow } from '../ui/Failure'
import { languageName, LANGUAGES_BY_NAME } from './languages'
import styles from './LanguageTabs.module.css'
import { SUBTITLE_MODES } from './subtitleModes'

/** A title whose detail page sets its own Default audio and Subtitles. */
export interface LanguageTabsItem {
  kind: 'movie' | 'series' | 'season'
  id: string
}

type TabKind = 'audio' | 'subtitles'

interface Subtitles {
  subtitleMode: SubtitleMode
  subtitleLanguage: Language | null
}

/** What a title's level inherits when it sets nothing itself: the series' for a season. */
interface WiderChoice extends Subtitles {
  name: 'Profile' | 'series'
  audioLanguage: Language | undefined
}

type OverrideChange = Omit<SetLanguageOverrideInput, 'itemId'>

const LEVEL_OF: Record<LanguageTabsItem['kind'], PreferenceSource> = {
  movie: 'TITLE',
  series: 'SERIES',
  season: 'SEASON',
}

const SOURCE_NAMES = new Map<PreferenceSource, string>([
  ['PROFILE', 'Profile'],
  ['SERIES', 'series'],
  ['SEASON', 'season'],
  ['TITLE', 'title'],
])

// A choice's id in a picker: the wider level, a subtitle mode, or a language.
const WIDER = 'wider'
const MODE = 'mode:'
const LANGUAGE = 'language:'

const UNSAVED = "Couldn't save the language. Try again."

/**
 * The Default audio and Subtitles tabs of a series, season or movie page. Each shows the language
 * that applies and where it comes from, and opens a picker that sets this title's own override or
 * clears it back to the wider level. Without a selected Profile there is nothing to show.
 */
export function LanguageTabs({ item }: Readonly<{ item: LanguageTabsItem }>) {
  const query = useQuery(LanguageTabsDocument, {
    variables: {
      id: item.id,
      movie: item.kind === 'movie',
      series: item.kind === 'series',
      season: item.kind === 'season',
    },
    fetchPolicy: 'cache-and-network',
  })
  // Never the answer of an earlier read: it may be another title's, or another Profile's.
  const data = query.data

  if (query.error) {
    return (
      <div className={styles.failure}>
        <FailureRow onRetry={query.refetch}>
          {requestFailureMessage(query.error, "Couldn't load the languages.")}
        </FailureRow>
      </div>
    )
  }
  if (!data) {
    return (
      <div className={styles.tabs}>
        <Loader size="xs" role="status" aria-label="Loading the languages" />
      </div>
    )
  }

  const shown = shownPreferences(item, data)
  if (!shown) {
    return null
  }
  return <Tabs item={item} {...shown} />
}

function shownPreferences(
  item: LanguageTabsItem,
  { movie, series, season, me }: LanguageTabsQuery,
): { preference: LanguagePreferenceFieldsFragment; wider: WiderChoice; first: Language[] } | null {
  const profile = me.languagePreferences
  const preference = (movie ?? series ?? season)?.selectedProfileState?.languagePreference
  if (!profile || !preference) {
    return null
  }
  const first = profile.audioLanguages
  if (item.kind === 'season' && season) {
    const fromSeries = season.series.selectedProfileState?.languagePreference
    if (!fromSeries) {
      return null
    }
    return {
      preference,
      first,
      wider: { name: 'series', ...fromSeries, audioLanguage: fromSeries.audioLanguages[0] },
    }
  }
  return {
    preference,
    first,
    wider: { name: 'Profile', ...profile, audioLanguage: profile.audioLanguages[0] },
  }
}

function Tabs({
  item,
  preference,
  wider,
  first,
}: Readonly<{
  item: LanguageTabsItem
  preference: LanguagePreferenceFieldsFragment
  wider: WiderChoice
  /** The Profile's own audio languages, which every picker lists first. */
  first: readonly Language[]
}>) {
  const [open, setOpen] = useState<TabKind | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [setOverride, { loading: saving }] = useMutation(SetLanguageOverrideDocument)
  const audioRef = useRef<HTMLButtonElement>(null)
  const subtitlesRef = useRef<HTMLButtonElement>(null)
  const level = LEVEL_OF[item.kind]
  const listing = languagesListing(first)
  const languageRows = listing.map((language) => ({
    id: LANGUAGE + language,
    label: languageName(language),
  }))

  async function save(change: OverrideChange) {
    setOpen(null)
    setRefusal(null)
    try {
      const { data } = await setOverride({ variables: { input: { itemId: item.id, ...change } } })
      const payload = data?.setLanguageOverride
      if (payload?.userErrors.length) {
        setRefusal(payload.userErrors.map(userErrorMessage).join(' '))
        return
      }
      if (!payload?.item) {
        setRefusal(UNSAVED)
      }
    } catch (error) {
      setRefusal(requestFailureMessage(error, UNSAVED))
    }
  }

  return (
    <>
      {refusal && (
        <p role="alert" className={styles.refusal}>
          {refusal}
        </p>
      )}
      <div className={styles.tabs}>
        <Tab
          kind="audio"
          name="Default audio"
          anchorRef={audioRef}
          disabled={saving}
          caption={`${audioName(preference.audioLanguages[0])} · ${sourcePhrase(preference.audioSource, level)}`}
          open={open}
          onOpen={setOpen}
          options={[
            { id: WIDER, label: `From ${wider.name} · ${audioName(wider.audioLanguage)}` },
            ...languageRows,
          ]}
          selected={audioChoice(preference, level)}
          onChoose={(id) => void save({ audioLanguage: chosenLanguage(listing, id) })}
        />
        <Tab
          kind="subtitles"
          name="Subtitles"
          anchorRef={subtitlesRef}
          disabled={saving}
          caption={`${subtitlesName(preference)} · ${sourcePhrase(preference.subtitleSource, level)}`}
          open={open}
          onOpen={setOpen}
          options={[
            { id: WIDER, label: `From ${wider.name} · ${subtitlesName(wider)}` },
            ...SUBTITLE_MODES.filter((mode) => mode.value !== 'ALWAYS').map((mode) => ({
              id: MODE + mode.value,
              label: mode.label,
            })),
            ...languageRows,
          ]}
          selected={subtitlesChoice(preference, level)}
          onChoose={(id) => void save(subtitlesChange(listing, id))}
        />
      </div>
    </>
  )
}

function Tab({
  kind,
  name,
  anchorRef,
  disabled,
  caption,
  open,
  onOpen,
  options,
  selected,
  onChoose,
}: Readonly<{
  kind: TabKind
  name: string
  anchorRef: RefObject<HTMLButtonElement | null>
  /** While an override saves, so that a second pick cannot overtake it. Focus stays on the tab. */
  disabled: boolean
  caption: string
  open: TabKind | null
  onOpen: (kind: TabKind | null) => void
  options: readonly PopoverOption<string>[]
  selected: string
  onChoose: (id: string) => void
}>) {
  const nameId = useId()
  const captionId = useId()
  const menuId = useId()
  const opened = open === kind
  return (
    <div className={styles.tabSlot}>
      <button
        ref={anchorRef}
        type="button"
        className={styles.tab}
        aria-disabled={disabled || undefined}
        aria-labelledby={nameId}
        aria-describedby={captionId}
        aria-haspopup="menu"
        aria-expanded={opened}
        aria-controls={opened ? menuId : undefined}
        onClick={() => {
          if (!disabled) {
            onOpen(opened ? null : kind)
          }
        }}
      >
        <span id={nameId} className={styles.tabName}>
          {name}
        </span>
        <span id={captionId} className={styles.tabValue}>
          {caption}
        </span>
      </button>
      {opened && (
        <CaretPopover
          id={menuId}
          heading={name}
          anchorRef={anchorRef}
          options={options}
          selected={selected}
          onChoose={onChoose}
          onDismiss={() => onOpen(null)}
          placement="below"
        />
      )}
    </div>
  )
}

// The Profile's own languages first, then every other language by name.
function languagesListing(first: readonly Language[]): Language[] {
  return [...first, ...LANGUAGES_BY_NAME.filter((language) => !first.includes(language))]
}

function audioName(language: Language | undefined): string {
  return language ? languageName(language) : 'File default'
}

function subtitlesName({ subtitleMode, subtitleLanguage }: Subtitles): string {
  if (subtitleMode === 'ALWAYS' && subtitleLanguage) {
    return languageName(subtitleLanguage)
  }
  return SUBTITLE_MODES.find((mode) => mode.value === subtitleMode)?.label ?? 'Other'
}

function sourcePhrase(source: PreferenceSource, level: PreferenceSource): string {
  if (source === level) {
    return 'set here'
  }
  return `from ${SOURCE_NAMES.get(source) ?? 'elsewhere'}`
}

// The row checked in each picker: this level's own choice, or the wider level when it sets none.
function audioChoice(preference: LanguagePreferenceFieldsFragment, level: PreferenceSource) {
  const own = preference.audioLanguages[0]
  if (preference.audioSource !== level || !own) {
    return WIDER
  }
  return LANGUAGE + own
}

function subtitlesChoice(preference: LanguagePreferenceFieldsFragment, level: PreferenceSource) {
  if (preference.subtitleSource !== level) {
    return WIDER
  }
  if (preference.subtitleMode === 'ALWAYS' && preference.subtitleLanguage) {
    return LANGUAGE + preference.subtitleLanguage
  }
  return MODE + preference.subtitleMode
}

// The wider choice clears this level's audio language; a language row of `listing` sets it.
function chosenLanguage(listing: readonly Language[], id: string): Language | null {
  return listing.find((language) => LANGUAGE + language === id) ?? null
}

// A mode row sets the mode alone, a language row turns subtitles on in it, and the wider choice
// clears both.
function subtitlesChange(listing: readonly Language[], id: string): OverrideChange {
  const mode = SUBTITLE_MODES.find((candidate) => MODE + candidate.value === id)
  if (mode) {
    return { subtitleMode: mode.value }
  }
  const language = chosenLanguage(listing, id)
  if (language) {
    return { subtitleLanguage: language, subtitleMode: 'ALWAYS' }
  }
  return { subtitleLanguage: null, subtitleMode: null }
}
