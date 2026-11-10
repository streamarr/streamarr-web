import { useApolloClient, useMutation, useQuery } from '@apollo/client/react'
import { ActionIcon, Center, Input, Loader, Radio, Select } from '@mantine/core'
import { useId, useState } from 'react'
import {
  LanguageSettingsDocument,
  SetLanguagePreferencesDocument,
  type Language,
  type ProfileLanguagePreferencesFieldsFragment,
} from '../graphql/generated/graphql'
import { isReading } from '../graphql/readAgain'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage } from '../graphql/userErrors'
import { FailureRow } from '../ui/Failure'
import { Icon } from '../ui/Icon'
import settingsStyles from '../styles/settings.module.css'
import { languageListing, languageName } from './languages'
import { SUBTITLE_MODES } from './subtitleModes'
import styles from './LanguageSettings.module.css'

type Preferences = Omit<ProfileLanguagePreferencesFieldsFragment, '__typename'>

// The most audio languages a Profile keeps (ADR 0043).
const MAX_AUDIO_LANGUAGES = 5
const UNSAVED = "Couldn't save your languages. Try again."
const STILL_READING = "Your languages were still loading, so that change wasn't saved."

const NO_SUBTITLE_LANGUAGE = { value: 'none', label: 'None' }

interface LanguageOption {
  value: Language
  label: string
  disabled?: boolean
}

const LISTING = languageListing()
const COMMON_OPTIONS: LanguageOption[] = LISTING.leading.map(optionOf)
const OTHER_OPTIONS: LanguageOption[] = LISTING.rest.map(optionOf)
const LANGUAGE_OPTIONS = [...COMMON_OPTIONS, ...OTHER_OPTIONS]

function optionOf(language: Language): LanguageOption {
  return { value: language, label: languageName(language) }
}

// The common languages and the rest as two groups, which the list divides with a hairline.
function grouped(common: LanguageOption[], others: LanguageOption[]) {
  return [
    { group: 'Common languages', items: common },
    { group: 'All other languages', items: others },
  ].filter(({ items }) => items.length > 0)
}

const GROUP_CLASS_NAMES = {
  dropdown: settingsStyles.popover,
  option: settingsStyles.popoverOption,
  group: settingsStyles.popoverGroup,
  groupLabel: settingsStyles.popoverGroupLabel,
}

/**
 * The selected Profile's own language preferences. Each change saves at once, and the screen shows
 * what the server last confirmed: a refused or failed change leaves it as it was.
 */
export function LanguageSettings() {
  const query = useQuery(LanguageSettingsDocument, {
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  })
  const client = useApolloClient()
  const [save, { loading: saving }] = useMutation(SetLanguagePreferencesDocument)
  // A save sends every field from the screen, so none starts while a read may still replace what
  // the screen shows with an answer older than the save.
  const busy = saving || query.loading
  const [refusal, setRefusal] = useState<string | null>(null)
  // Never the answer of an earlier read: after a Profile switch, it is the other Profile's.
  const data = query.data

  async function change(next: Preferences) {
    if (saving) {
      return
    }
    // A revalidation reads beside the query without marking it loading, so it is asked here.
    if ([...client.getObservableQueries([LanguageSettingsDocument])].some(isReading)) {
      setRefusal(STILL_READING)
      return
    }
    setRefusal(null)
    try {
      const { data: result } = await save({
        variables: { input: next },
        update(cache, { data: answer }) {
          const saved = answer?.setLanguagePreferences?.languagePreferences
          if (saved) {
            cache.updateQuery({ query: LanguageSettingsDocument }, (current) =>
              current ? { me: { ...current.me, languagePreferences: saved } } : current,
            )
          }
        },
      })
      const payload = result?.setLanguagePreferences
      if (payload?.userErrors.length) {
        setRefusal(payload.userErrors.map(userErrorMessage).join(' '))
        return
      }
      if (!payload?.languagePreferences) {
        setRefusal(UNSAVED)
      }
    } catch (error) {
      setRefusal(requestFailureMessage(error, UNSAVED))
    }
  }

  return (
    <div className={styles.page}>
      <div className={settingsStyles.pageHeading}>
        <h1>Languages</h1>
      </div>
      <LanguageSettingsContent
        loaded={data !== undefined}
        saved={data?.me.languagePreferences ?? null}
        error={query.error}
        onRetry={query.refetch}
        busy={busy}
        refusal={refusal}
        onChange={(next) => void change(next)}
      />
    </div>
  )
}

function LanguageSettingsContent({
  loaded,
  saved,
  error,
  onRetry,
  busy,
  refusal,
  onChange,
}: Readonly<{
  loaded: boolean
  saved: ProfileLanguagePreferencesFieldsFragment | null
  error: unknown
  onRetry: () => Promise<unknown>
  /** While a save or a read is in flight: the controls take no change. */
  busy: boolean
  refusal: string | null
  onChange: (next: Preferences) => void
}>) {
  if (error) {
    return (
      <FailureRow onRetry={onRetry}>
        {requestFailureMessage(error, "Couldn't load your languages.")}
      </FailureRow>
    )
  }
  if (!loaded) {
    return (
      <Center h={200}>
        <Loader role="status" aria-label="Loading your languages" />
      </Center>
    )
  }
  if (!saved) {
    return <p>Choose a Profile to set its languages.</p>
  }

  const { audioLanguages, subtitleLanguage, subtitleMode } = saved
  const current: Preferences = { audioLanguages, subtitleLanguage, subtitleMode }
  return (
    <div className={settingsStyles.formPanel} data-testid="language-settings-panel">
      <div className={settingsStyles.form}>
        {refusal && (
          <p role="alert" className={styles.refusal}>
            {refusal}
          </p>
        )}
        <AudioLanguages
          languages={audioLanguages}
          busy={busy}
          onChange={(next) => onChange({ ...current, audioLanguages: next })}
        />
        <Select
          classNames={{ label: styles.settingName, ...GROUP_CLASS_NAMES }}
          label="Subtitle language"
          description="Set the default subtitle language."
          searchable
          allowDeselect={false}
          value={subtitleLanguage ?? NO_SUBTITLE_LANGUAGE.value}
          data={[NO_SUBTITLE_LANGUAGE, ...optionsShowing(subtitleLanguage)]}
          readOnly={busy}
          onChange={(value) =>
            onChange({ ...current, subtitleLanguage: isLanguageOption(value) ? value : null })
          }
        />
        <Radio.Group
          classNames={{ label: styles.settingName }}
          label="Show subtitles"
          value={subtitleMode}
          onChange={(value) => {
            const mode = SUBTITLE_MODES.find((candidate) => candidate.value === value)
            if (mode) {
              onChange({ ...current, subtitleMode: mode.value })
            }
          }}
        >
          <div className={styles.modes}>
            {SUBTITLE_MODES.map((mode) => (
              <Radio
                key={mode.value}
                value={mode.value}
                label={mode.label}
                description={mode.description}
                disabled={busy}
              />
            ))}
          </div>
        </Radio.Group>
      </div>
    </div>
  )
}

function AudioLanguages({
  languages,
  busy,
  onChange,
}: Readonly<{
  languages: readonly Language[]
  busy: boolean
  onChange: (next: Language[]) => void
}>) {
  const labelId = useId()
  return (
    <Input.Wrapper
      className={styles.audio}
      classNames={{ label: styles.settingName, description: styles.settingDescription }}
      label="Audio languages"
      labelElement="div"
      labelProps={{ id: labelId }}
      description="Set playback language defaults in priority order."
    >
      <ol aria-labelledby={labelId} className={styles.list}>
        {languages.map((language, index) => {
          const name = languageName(language)
          return (
            <li key={language} className={styles.row}>
              <span className={styles.rank}>{index + 1}</span>
              <span className={styles.name} data-testid="language-name">
                {name}
              </span>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Move ${name} up`}
                disabled={busy || index === 0}
                onClick={() => onChange(moved(languages, index, -1))}
              >
                <Icon name="chevron-up" size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Move ${name} down`}
                disabled={busy || index === languages.length - 1}
                onClick={() => onChange(moved(languages, index, 1))}
              >
                <Icon name="chevron-down" size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Remove ${name}`}
                disabled={busy}
                onClick={() => onChange(languages.filter((other) => other !== language))}
              >
                <Icon name="close" size={16} />
              </ActionIcon>
            </li>
          )
        })}
      </ol>
      {languages.length === 0 && (
        <p className={styles.description}>
          No audio languages. Each file plays its own default track.
        </p>
      )}
      {languages.length < MAX_AUDIO_LANGUAGES ? (
        <Select
          classNames={GROUP_CLASS_NAMES}
          label="Add an audio language"
          placeholder="Choose a language"
          searchable
          value={null}
          data={grouped(
            COMMON_OPTIONS.filter((option) => !languages.includes(option.value)),
            OTHER_OPTIONS.filter((option) => !languages.includes(option.value)),
          )}
          readOnly={busy}
          onChange={(value) => {
            if (isLanguageOption(value)) {
              onChange([...languages, value])
            }
          }}
        />
      ) : (
        <p className={styles.description}>A Profile keeps up to five audio languages.</p>
      )}
    </Input.Wrapper>
  )
}

function moved(languages: readonly Language[], index: number, by: -1 | 1): Language[] {
  const next = languages.filter((_, at) => at !== index)
  next.splice(index + by, 0, ...languages.slice(index, index + 1))
  return next
}

function isLanguageOption(value: string | null): value is Language {
  return LANGUAGE_OPTIONS.some((option) => option.value === value)
}

// A language newer than this client stays visible but cannot be chosen again from here.
function optionsShowing(saved: Language | null) {
  if (saved === null || LANGUAGE_OPTIONS.some((option) => option.value === saved)) {
    return grouped(COMMON_OPTIONS, OTHER_OPTIONS)
  }
  return grouped(COMMON_OPTIONS, [...OTHER_OPTIONS, { ...optionOf(saved), disabled: true }])
}
