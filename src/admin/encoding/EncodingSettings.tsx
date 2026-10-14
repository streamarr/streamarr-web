import { useMutation, useQuery } from '@apollo/client/react'
import { Center, Loader, Select } from '@mantine/core'
import { useState } from 'react'
import {
  ChangeEncoderPresetDocument,
  EncoderPresetSettingDocument,
  type EncoderPreset,
  type EncoderPresetChoice,
  type EncoderPresetSettingFieldsFragment,
} from '../../graphql/generated/graphql'
import { userErrorMessage } from '../../graphql/userErrors'
import { RetryAlert } from '../../ui/RetryAlert'
import styles from '../Settings.module.css'

type KnownChoice = Exclude<EncoderPresetChoice, '%future added value'>

const CHOICES: readonly { value: KnownChoice; label: string }[] = [
  { value: 'AUTOMATIC', label: 'Automatic' },
  { value: 'ULTRAFAST', label: 'ultrafast' },
  { value: 'SUPERFAST', label: 'superfast' },
  { value: 'VERYFAST', label: 'veryfast' },
  { value: 'FASTER', label: 'faster' },
  { value: 'FAST', label: 'fast' },
  { value: 'MEDIUM', label: 'medium' },
  { value: 'SLOW', label: 'slow' },
  { value: 'SLOWER', label: 'slower' },
  { value: 'VERYSLOW', label: 'veryslow' },
]

const CODECS = [
  { field: 'h264', name: 'H.264' },
  { field: 'hevc', name: 'HEVC' },
  { field: 'av1', name: 'AV1' },
] as const

const UNCONFIRMED =
  "Couldn't confirm the change. Refresh the page to check the saved preset before trying again."

/**
 * The server-wide encoder preset. The select always shows the setting the server last confirmed;
 * a refused or unconfirmed change leaves it in place and shows why beside the select.
 */
export function EncodingSettings() {
  const query = useQuery(EncoderPresetSettingDocument, { fetchPolicy: 'cache-and-network' })
  const [change, { loading: saving }] = useMutation(ChangeEncoderPresetDocument)
  const [refusal, setRefusal] = useState<string | null>(null)
  const setting = (query.data ?? query.previousData)?.encoderPresetSetting

  async function choose(value: string | null) {
    const choice = CHOICES.find((candidate) => candidate.value === value)
    if (!choice || saving) return
    setRefusal(null)
    try {
      const { data } = await change({
        variables: { input: { preset: choice.value } },
        update(cache, { data: result }) {
          const saved = result?.changeEncoderPreset?.encoderPresetSetting
          if (saved)
            cache.writeQuery({
              query: EncoderPresetSettingDocument,
              data: { encoderPresetSetting: saved },
            })
        },
      })
      const payload = data?.changeEncoderPreset
      if (payload?.userErrors.length) {
        setRefusal(payload.userErrors.map(userErrorMessage).join(' '))
        return
      }
      if (!payload?.encoderPresetSetting) setRefusal(UNCONFIRMED)
    } catch {
      setRefusal(UNCONFIRMED)
    }
  }

  return (
    <>
      <div className={styles.pageHeading}>
        <h1>Encoding</h1>
      </div>
      {setting && query.error && (
        <RetryAlert mb="md" onRetry={query.refetch}>
          Couldn't load the latest encoder preset.
        </RetryAlert>
      )}
      <EncodingContent
        setting={setting}
        error={!setting && !!query.error}
        onRetry={query.refetch}
        saving={saving}
        refusal={refusal}
        onChoose={(value) => void choose(value)}
      />
    </>
  )
}

function EncodingContent({
  setting,
  error,
  onRetry,
  saving,
  refusal,
  onChoose,
}: Readonly<{
  setting: EncoderPresetSettingFieldsFragment | undefined
  error: boolean
  onRetry: () => Promise<unknown>
  saving: boolean
  refusal: string | null
  onChoose: (value: string | null) => void
}>) {
  if (error) return <RetryAlert onRetry={onRetry}>Couldn't load the encoder preset.</RetryAlert>
  if (!setting)
    return (
      <Center h={200}>
        <Loader role="status" aria-label="Loading the encoder preset" />
      </Center>
    )

  return (
    <div className={styles.formPanel}>
      <div className={styles.form}>
        <Select
          classNames={{ dropdown: styles.popover, option: styles.popoverOption }}
          label="Encoder preset"
          description="Faster presets start playback sooner and fit more encodes on a worker. Slower presets give a better picture at the same bitrate. A change reaches only quality levels that start afterwards. A quality level that has already started keeps its preset, even after a seek."
          value={setting.preset}
          data={CHOICES}
          allowDeselect={false}
          disabled={saving}
          error={refusal}
          onChange={onChoose}
        />
        <p className={styles.fieldNote}>{automaticLine(setting.automatic)}</p>
      </div>
    </div>
  )
}

function automaticLine(automatic: EncoderPresetSettingFieldsFragment['automatic']): string {
  const groups = new Map<EncoderPreset, string[]>()
  for (const codec of CODECS) {
    const preset = automatic[codec.field]
    groups.set(preset, [...(groups.get(preset) ?? []), codec.name])
  }
  const phrases = [...groups].map(([preset, codecs]) => `${presetName(preset)} for ${list(codecs)}`)
  if (phrases.length === 1) return `Automatic uses ${phrases[0]}.`
  return `Automatic uses ${phrases.slice(0, -1).join(', ')}, and ${phrases.at(-1)}.`
}

function presetName(preset: EncoderPreset): string {
  return CHOICES.find((choice) => choice.value === preset)?.label ?? preset.toLowerCase()
}

function list(names: readonly string[]): string {
  if (names.length < 2) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
