import { Alert, Button, TextInput } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { groupByInputPath, userErrorMessage } from '../../graphql/userErrors'
import { Icon } from '../../ui/Icon'
import { useLibraryCommands } from './useLibraryAdmin'
import styles from '../Settings.module.css'

/**
 * Creates LOCAL movie or series libraries with TMDB metadata through the pinned server API.
 * Server folders are entered as text. Field and transport failures preserve the current draft.
 * onCreated receives the confirmed ID once; callers keep the user inside server settings.
 */
export function CreateLibrary({ onCreated }: Readonly<{ onCreated: (id: string) => void }>) {
  const [name, setName] = useState('Movies')
  const [filepath, setFilepath] = useState('')
  const [type, setType] = useState<'MOVIE' | 'SERIES'>('MOVIE')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const nameInput = useRef<HTMLInputElement>(null)
  const pathInput = useRef<HTMLInputElement>(null)
  const commands = useLibraryCommands()

  // Request completion must re-enable the inputs before focus can move to a rejected field.
  useEffect(() => {
    if (commands.pending) return
    if (errors.name) nameInput.current?.focus()
    else if (errors.filepath) pathInput.current?.focus()
  }, [errors, commands.pending])

  async function submit(event: React.SubmitEvent) {
    event.preventDefault()
    if (commands.pending) return
    commands.clearError()
    const validation: Record<string, string> = {}
    if (!name.trim()) validation.name = 'Enter a library name.'
    if (!filepath.trim()) validation.filepath = 'Enter a folder on your server.'
    setErrors(validation)
    if (Object.keys(validation).length) {
      return
    }
    const result = await commands.create({
      name: name.trim(),
      filepath: filepath.trim(),
      type,
      backend: 'LOCAL',
      externalAgentStrategy: 'TMDB',
    })
    if (!result) return
    if (result.userErrors.length) {
      const next: Record<string, string> = {}
      for (const [path, messages] of groupByInputPath(result.userErrors)) {
        const key = path === 'name' || path === 'filepath' ? path : 'form'
        next[key] = [next[key], ...messages.map(userErrorMessage)].filter(Boolean).join(' ')
      }
      setErrors(next)
      return
    }
    if (result.library) onCreated(result.library.id)
    else
      setErrors({
        form: "The server didn't return the new library. Check the library list before trying again.",
      })
  }

  return (
    <>
      <div className={styles.pageHeading}>
        <h1>Add library</h1>
      </div>
      <div className={styles.formPanel}>
        <form className={styles.form} onSubmit={submit} noValidate aria-busy={commands.pending}>
          {(commands.error || errors.form) && (
            <Alert role="alert" color="red">
              {commands.error || errors.form}
            </Alert>
          )}
          <fieldset className={styles.typeField} disabled={commands.pending}>
            <legend>Content type</legend>
            <div className={styles.typeOptions}>
              {(['MOVIE', 'SERIES'] as const).map((value) => (
                <label
                  key={value}
                  className={type === value ? styles.typeSelected : styles.typeOption}
                >
                  <input
                    type="radio"
                    name="content-type"
                    value={value}
                    checked={type === value}
                    onChange={() => {
                      setType(value)
                      if (!name || name === 'Movies' || name === 'TV shows')
                        setName(value === 'MOVIE' ? 'Movies' : 'TV shows')
                    }}
                  />
                  <Icon name={value === 'MOVIE' ? 'movie' : 'series'} />
                  {value === 'MOVIE' ? 'Movies' : 'TV shows'}
                  {type === value && <Icon name="check" size={16} />}
                </label>
              ))}
            </div>
          </fieldset>
          <TextInput
            ref={nameInput}
            label="Library name"
            required
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            error={errors.name}
            disabled={commands.pending}
            autoComplete="off"
          />
          <TextInput
            ref={pathInput}
            label="Server folder"
            description="Enter the folder path as it appears on your server."
            required
            value={filepath}
            onChange={(event) => setFilepath(event.currentTarget.value)}
            placeholder="/media/movies"
            error={errors.filepath}
            disabled={commands.pending}
            autoComplete="off"
            spellCheck={false}
          />
          <p className={styles.scanNote}>
            <Icon name="scan" />
            The initial scan starts automatically.
          </p>
          <div className={styles.formActions}>
            <Button
              component={Link}
              to="/settings/server/libraries"
              variant="default"
              disabled={commands.pending}
              onClick={(event) => {
                if (commands.pending) event.preventDefault()
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={commands.pending} leftSection={<Icon name="plus" />}>
              Add library
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}
