import { useMutation, useQuery } from '@apollo/client/react'
import { ActionIcon, Center, Input, Loader, Radio, Select } from '@mantine/core'
import { useId, useState } from 'react'
import {
  LanguageSettingsDocument,
  SetLanguagePreferencesDocument,
  type Language,
  type ProfileLanguagePreferencesFieldsFragment,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage } from '../graphql/userErrors'
import { FailureRow } from '../ui/Failure'
import { Icon } from '../ui/Icon'
import settingsStyles from '../admin/Settings.module.css'
import { languageName, LANGUAGES_BY_NAME } from './languages'
import { SUBTITLE_MODES } from './subtitleModes'
import styles from './LanguageSettings.module.css'

type Preferences = Omit<ProfileLanguagePreferencesFieldsFragment, '__typename'>

// The most audio languages a Profile keeps (ADR 0043).
const MAX_AUDIO_LANGUAGES = 5
const UNSAVED = "Couldn't save your languages. Try again."

const NO_SUBTITLE_LANGUAGE = { value: 'none', label: 'None' }

const LANGUAGE_OPTIONS = LANGUAGES_BY_NAME.map((language) => ({
  value: language,
  label: languageName(language),
}))

/**
 * The selected Profile's own language preferences. Each change saves at once, and the screen shows
 * what the server last confirmed: a refused or failed change leaves it as it was.
 */
export function LanguageSettings() {
  const query = useQuery(LanguageSettingsDocument, { fetchPolicy: 'cache-and-network' })
  const [save, { loading: saving }] = useMutation(SetLanguagePreferencesDocument)
  const [refusal, setRefusal] = useState<string | null>(null)
  const data = query.data ?? query.previousData

  async function change(next: Preferences) {
    if (saving) {
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
    } catch {
      setRefusal(UNSAVED)
    }
  }

  return (
    <div className={`${settingsStyles.settings} ${styles.page}`}>
      <div className={settingsStyles.pageHeading}>
        <h1>Languages</h1>
      </div>
      <LanguageSettingsContent
        loaded={data !== undefined}
        saved={data?.me.languagePreferences ?? null}
        error={data ? undefined : query.error}
        onRetry={query.refetch}
        saving={saving}
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
  saving,
  refusal,
  onChange,
}: Readonly<{
  loaded: boolean
  saved: ProfileLanguagePreferencesFieldsFragment | null
  error: unknown
  onRetry: () => Promise<unknown>
  saving: boolean
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
    <div className={settingsStyles.formPanel}>
      <div className={settingsStyles.form}>
        {refusal && (
          <p role="alert" className={styles.refusal}>
            {refusal}
          </p>
        )}
        <AudioLanguages
          languages={audioLanguages}
          saving={saving}
          onChange={(next) => onChange({ ...current, audioLanguages: next })}
        />
        <Select
          classNames={{ dropdown: settingsStyles.popover, option: settingsStyles.popoverOption }}
          label="Subtitle language"
          description="Subtitles that start on show in this language."
          searchable
          allowDeselect={false}
          value={subtitleLanguage ?? NO_SUBTITLE_LANGUAGE.value}
          data={[NO_SUBTITLE_LANGUAGE, ...optionsShowing(subtitleLanguage)]}
          readOnly={saving}
          onChange={(value) =>
            onChange({ ...current, subtitleLanguage: isLanguageOption(value) ? value : null })
          }
        />
        <Radio.Group
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
                disabled={saving}
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
  saving,
  onChange,
}: Readonly<{
  languages: readonly Language[]
  saving: boolean
  onChange: (next: Language[]) => void
}>) {
  const labelId = useId()
  return (
    <Input.Wrapper
      className={styles.audio}
      label="Audio languages"
      labelElement="div"
      labelProps={{ id: labelId }}
      description="A stream plays the first of these languages that the file holds."
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
                disabled={saving || index === 0}
                onClick={() => onChange(moved(languages, index, -1))}
              >
                <Icon name="chevron-up" size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Move ${name} down`}
                disabled={saving || index === languages.length - 1}
                onClick={() => onChange(moved(languages, index, 1))}
              >
                <Icon name="chevron-down" size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Remove ${name}`}
                disabled={saving}
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
          classNames={{ dropdown: settingsStyles.popover, option: settingsStyles.popoverOption }}
          label="Add an audio language"
          placeholder="Choose a language"
          searchable
          value={null}
          data={LANGUAGE_OPTIONS.filter((option) => !languages.includes(option.value))}
          readOnly={saving}
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
    return LANGUAGE_OPTIONS
  }
  return [...LANGUAGE_OPTIONS, { value: saved, label: languageName(saved), disabled: true }]
}
