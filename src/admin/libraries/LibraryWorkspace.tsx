import { Alert, Button, Center, Collapse, Loader, Select } from '@mantine/core'
import { useReducedMotion } from '@mantine/hooks'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { ImageRefreshMode } from '../../graphql/generated/graphql'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { DestructiveButton } from '../../ui/DestructiveButton'
import { Icon } from '../../ui/Icon'
import { EmptyLibraries } from './EmptyLibraries'
import { LibraryStatus } from './LibraryStatus'
import {
  canMaintainLibrary,
  lastScanLabel,
  libraryIcon,
  libraryName,
  type ManagedLibrary,
} from './libraryModel'
import { useAdminLibraries, useLibraryCommands } from './useLibraryAdmin'
import styles from '../Settings.module.css'

/**
 * D3 inventory and selected-library workspace. Selection belongs to the route so reload/back
 * restore it. Missing IDs display a recovery state instead of silently acting on another library.
 * New inventories select the first library only when no explicit selection was requested.
 */
export function LibraryWorkspace({
  selectedId,
  onSelect,
}: Readonly<{
  selectedId?: string
  onSelect: (id: string) => void
}>) {
  const query = useAdminLibraries()
  const [notice, setNotice] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const libraries = query.data?.libraries
  const current = selectedId
    ? libraries?.find((library) => library.id === selectedId)
    : libraries?.[0]
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [notice])

  return (
    <>
      <div className={styles.pageHeading}>
        <h1 ref={heading} tabIndex={-1}>
          Libraries{libraries && <span className={styles.libraryCount}>{libraries.length}</span>}
        </h1>
        {!!libraries?.length && (
          <Button
            component={Link}
            to="/settings/server/libraries/new"
            leftSection={<Icon name="plus" />}
          >
            Add library
          </Button>
        )}
      </div>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>
            <Icon name="close" size={16} />
          </button>
        </p>
      )}
      {query.error && (
        <Alert role="alert" color="red" mb="md">
          Couldn't load the latest library state.{' '}
          <Button variant="default" onClick={() => void query.refetch().catch(() => {})}>
            Try again
          </Button>
        </Alert>
      )}
      {!libraries ? (
        !query.error && (
          <Center h={200}>
            <Loader role="status" aria-label="Loading libraries" />
          </Center>
        )
      ) : libraries.length === 0 ? (
        !query.error && <EmptyLibraries canCreate />
      ) : (
        <div className={styles.splitPanel}>
          <nav className={styles.libraryList} aria-label="Libraries to manage">
            {libraries.map((library) => (
              <button
                type="button"
                key={library.id}
                className={
                  library.id === current?.id ? styles.selectedLibrary : styles.libraryChoice
                }
                aria-current={library.id === current?.id ? 'true' : undefined}
                onClick={() => {
                  setNotice('')
                  onSelect(library.id)
                }}
              >
                <Icon name={libraryIcon(library.type)} />
                <div>
                  <strong>{libraryName(library)}</strong>
                  <LibraryStatus status={library.status} />
                </div>
                <Icon name="chevron-right" size={14} />
              </button>
            ))}
          </nav>
          {current ? (
            <LibraryDetails
              key={current.id}
              library={current}
              stale={!!query.error}
              onRemoved={() => {
                setNotice(`${libraryName(current)} removed. Files were kept on disk.`)
                const next = libraries.find((library) => library.id !== current.id)
                onSelect(next?.id ?? '')
              }}
            />
          ) : (
            <div className={styles.empty}>
              <h2>Library unavailable</h2>
              <p>It may have been removed. Select another library.</p>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function LibraryDetails({
  library,
  stale,
  onRemoved,
}: Readonly<{
  library: ManagedLibrary
  stale: boolean
  onRemoved: () => void
}>) {
  const commands = useLibraryCommands()
  const [refreshOpen, setRefreshOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [imageMode, setImageMode] = useState<ImageRefreshMode>('PRESERVE')
  const [notice, setNotice] = useState('')
  const refreshTrigger = useRef<HTMLButtonElement>(null)
  const restoreRefreshFocus = useRef(false)
  const reduceMotion = useReducedMotion()
  const maintainable = canMaintainLibrary(library)
  const disabled = stale || !maintainable || commands.pending
  const name = libraryName(library)
  const refreshId = `refresh-${library.id}`

  const [previousStatus, setPreviousStatus] = useState(library.status)
  if (previousStatus !== library.status) {
    setPreviousStatus(library.status)
    setNotice('')
  }
  useEffect(() => {
    // A successful submit must re-enable the trigger before focus can return to it.
    if (restoreRefreshFocus.current && !refreshOpen && !commands.pending) {
      restoreRefreshFocus.current = false
      refreshTrigger.current?.focus({ preventScroll: true })
    }
  }, [refreshOpen, commands.pending])

  function closeRefresh() {
    restoreRefreshFocus.current = true
    setRefreshOpen(false)
    commands.clearError()
  }

  return (
    <article className={styles.detailPane} aria-label={`${name} settings`}>
      <div className={styles.detailHeading}>
        <div className={styles.typeIcon}>
          <Icon
            name={libraryIcon(library.type)}
            label={
              library.type === 'MOVIE'
                ? 'Movies'
                : library.type === 'SERIES'
                  ? 'TV shows'
                  : 'Library'
            }
          />
        </div>
        <h2>{name}</h2>
        <div className={styles.detailStatus} role="status">
          <LibraryStatus status={library.status} />
        </div>
      </div>
      <dl className={styles.metadata}>
        <div className={styles.metadataFolder}>
          <dt>Server folder</dt>
          <dd>{library.filepathUri}</dd>
        </div>
        <div>
          <dt>Last scan</dt>
          <dd className={styles.timestamp}>{lastScanLabel(library)}</dd>
        </div>
      </dl>
      <Collapse
        expanded={refreshOpen}
        transitionDuration={reduceMotion ? 0 : 180}
        transitionTimingFunction="ease-out"
        keepMounted={false}
      >
        <section
          id={refreshId}
          className={styles.refreshEditor}
          aria-label={`Refresh metadata for ${name}`}
        >
          <form
            className={styles.refreshForm}
            onSubmit={async (event) => {
              event.preventDefault()
              if (disabled) return
              if (await commands.refresh(library.id, imageMode)) {
                setNotice(
                  `Metadata refresh requested for ${name}. Refresh the page to see the latest status.`,
                )
                closeRefresh()
              }
            }}
          >
            <Select
              className={styles.refreshImages}
              classNames={{ dropdown: styles.popover, option: styles.popoverOption }}
              label="Images"
              value={imageMode}
              allowDeselect={false}
              disabled={disabled}
              onChange={(value) => {
                if (
                  value === 'PRESERVE' ||
                  value === 'REFRESH_IF_CHANGED' ||
                  value === 'FORCE_REFRESH'
                )
                  setImageMode(value)
              }}
              data={[
                { value: 'PRESERVE', label: 'Keep existing images' },
                { value: 'REFRESH_IF_CHANGED', label: 'Update changed images' },
                { value: 'FORCE_REFRESH', label: 'Download all images again' },
              ]}
            />
            <div className={styles.refreshActions}>
              <Button
                type="button"
                variant="default"
                disabled={commands.pending}
                onClick={closeRefresh}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={disabled}
                loading={commands.pending}
                leftSection={<Icon name="refresh" />}
              >
                Refresh metadata
              </Button>
            </div>
          </form>
        </section>
      </Collapse>
      <div className={styles.detailActions}>
        <h3>Library actions</h3>
        <div className={styles.primaryActions}>
          <Button
            renderRoot={(props) => (
              <Link
                {...props}
                to="/library/$libraryId"
                params={{ libraryId: library.id }}
                search={{ by: 'ADDED', direction: 'DESC' }}
              />
            )}
            variant="default"
            leftSection={<Icon name="arrow-right" />}
          >
            View library
          </Button>
          <Button
            variant="default"
            disabled={disabled}
            leftSection={<Icon name="scan" />}
            onClick={async () => {
              setRefreshOpen(false)
              if (await commands.scan(library.id))
                setNotice(`Scan requested for ${name}. Refresh the page to see the latest status.`)
            }}
          >
            Scan library
          </Button>
          <Button
            ref={refreshTrigger}
            variant="default"
            disabled={disabled}
            leftSection={<Icon name="refresh" />}
            aria-expanded={refreshOpen}
            aria-controls={refreshOpen ? refreshId : undefined}
            onClick={() => {
              commands.clearError()
              if (refreshOpen) closeRefresh()
              else {
                setImageMode('PRESERVE')
                setRefreshOpen(true)
              }
            }}
          >
            Refresh metadata
          </Button>
          <DestructiveButton
            disabled={disabled}
            onClick={() => {
              setRefreshOpen(false)
              commands.clearError()
              setRemoving(true)
            }}
          >
            Remove library
          </DestructiveButton>
          {!maintainable && (
            <p>
              {library.status === 'SCANNING' || library.status === 'REFRESHING'
                ? 'Maintenance is in progress. Refresh the page to see the latest status. You can still view this library.'
                : 'Maintenance is unavailable for this library status.'}
            </p>
          )}
        </div>
        {notice && (
          <p className={styles.actionNotice} role="status">
            {notice}
          </p>
        )}
        {commands.error && !removing && (
          <Alert role="alert" color="red" mt="md">
            {commands.error}
          </Alert>
        )}
      </div>
      <ConfirmDialog
        opened={removing}
        title={`Remove ${name}?`}
        body="This removes the library and its indexed titles from Streamarr and stops active playback. Your files stay on disk."
        confirmLabel="Remove library"
        destructive
        icon={null}
        pending={commands.pending}
        disabled={disabled}
        error={
          commands.error ||
          (stale
            ? 'Refresh the library state before removing it.'
            : !maintainable
              ? 'This library cannot be removed while maintenance is in progress.'
              : null)
        }
        onClose={() => {
          setRemoving(false)
          commands.clearError()
        }}
        onConfirm={async () => {
          if (disabled) return
          await commands.remove(library.id, onRemoved)
        }}
      />
    </article>
  )
}
