import { Alert, Button, Center, Collapse, Loader, Select } from '@mantine/core'
import { useReducedMotion } from '@mantine/hooks'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import type { ImageRefreshMode } from '../../graphql/generated/graphql'
import { requestFailureMessage } from '../../graphql/requestErrors'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { DestructiveButton } from '../../ui/DestructiveButton'
import { FailureRow } from '../../ui/Failure'
import { Icon } from '../../ui/Icon'
import { EmptyLibraries } from './EmptyLibraries'
import { LibraryStatus } from './LibraryStatus'
import {
  canMaintainLibrary,
  lastScanLabel,
  libraryIcon,
  libraryName,
  libraryTypeLabel,
  stoppableRun,
  type ManagedLibrary,
  type StoppableRun,
} from './libraryModel'
import {
  NO_LONGER_PERMITTED,
  useAdminLibraries,
  useLibraryCommands,
  type LiveInventoryStop,
} from './useLibraryAdmin'
import styles from '../Settings.module.css'

const LIVE_INVENTORY_STOP_MESSAGES = {
  forbidden: NO_LONGER_PERMITTED,
  failed: 'Live status stopped. Reload the page to see the latest status.',
} as const satisfies Record<LiveInventoryStop, string>

const IMAGE_REFRESH_OPTIONS = [
  { value: 'PRESERVE', label: 'Keep existing images' },
  { value: 'REFRESH_IF_CHANGED', label: 'Update changed images' },
  { value: 'FORCE_REFRESH', label: 'Download all images again' },
] satisfies { value: ImageRefreshMode; label: string }[]

const STOP_ACTIONS = {
  scan: {
    label: 'Stop scan',
    description:
      'Stopping lets the files and titles already in progress finish. Nothing is rolled back, and titles the scan already added stay.',
  },
  refresh: {
    label: 'Stop refresh',
    description:
      'Stopping lets the titles already in progress finish. Nothing is rolled back, and titles the refresh already updated keep their new details.',
  },
} as const satisfies Record<StoppableRun, { label: string; description: string }>

// The run a STOPPING library stops, if the panel saw that run before the stop.
type StoppedRun = StoppableRun | 'unseen'

// A stop does not wait for background artwork, so details can still arrive after it.
const STOPPED_NOTES = {
  scan: 'Scan stopped. Details such as cast photos can still appear for titles the scan already processed.',
  refresh:
    'Metadata refresh stopped. Details such as cast photos can still appear for titles the refresh already processed.',
  unseen:
    'Scan or metadata refresh stopped. Details such as cast photos can still appear for titles already processed.',
} as const satisfies Record<StoppedRun, string>

type LibraryStatusValue = ManagedLibrary['administration']['status']

type Acknowledgement = { text: string; status: LibraryStatusValue }

// A library that leaves STOPPING for its restored status says its run stopped. A busy status
// right after STOPPING belongs to a later run, which a missed change or a read can reveal first.
// Otherwise an acknowledgement lasts while the library keeps the status its operation started.
function acknowledgementAfter(
  current: Acknowledgement | null,
  change: { from: LibraryStatusValue; to: LibraryStatusValue; stopped: StoppedRun },
): Acknowledgement | null {
  const restored = canMaintainLibrary({ status: change.to })
  if (change.from === 'STOPPING' && restored)
    return { text: STOPPED_NOTES[change.stopped], status: change.to }
  return current?.status === change.to ? current : null
}

function isFocusLost(): boolean {
  return document.activeElement === null || document.activeElement === document.body
}

function maintenanceGuidance(status: LibraryStatusValue): string {
  if (status === 'SCANNING' || status === 'REFRESHING')
    return 'Maintenance is in progress. You can still view this library.'
  if (status === 'STOPPING')
    return 'The scan or refresh is stopping. You can still view this library.'
  return 'Maintenance is unavailable for this library status.'
}

/**
 * Library inventory and selected-library workspace. Selection belongs to the route so reload/back
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
  const { liveStop } = query
  const [notice, setNotice] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const libraries = query.data?.libraries
  const empty = libraries?.length === 0
  // After the last removal the empty state takes focus instead.
  useEffect(() => {
    if (notice && !empty) heading.current?.focus({ preventScroll: true })
  }, [notice, empty])

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
        <output className={styles.notice}>
          {notice}
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>
            <Icon name="close" size={16} />
          </button>
        </output>
      )}
      {liveStop && (
        <Alert role="alert" color="red" mb="md">
          {LIVE_INVENTORY_STOP_MESSAGES[liveStop]}
        </Alert>
      )}
      {query.error && (
        <FailureRow className={styles.failureRow} onRetry={query.refetch}>
          {requestFailureMessage(query.error, "Couldn't load the latest library state.")}
        </FailureRow>
      )}
      <LibraryInventory
        libraries={libraries}
        selectedId={selectedId}
        stale={!!query.error}
        focusEmptyHeading={!!notice}
        onSelect={(id) => {
          setNotice('')
          onSelect(id)
        }}
        onRemoved={(removed) => {
          setNotice(`${libraryName(removed)} removed. Files were kept on disk.`)
          const next = libraries?.find((library) => library.id !== removed.id)
          onSelect(next?.id ?? '')
        }}
      />
    </>
  )
}

function LibraryInventory({
  libraries,
  selectedId,
  stale,
  focusEmptyHeading,
  onSelect,
  onRemoved,
}: Readonly<{
  libraries: readonly ManagedLibrary[] | undefined
  selectedId?: string
  stale: boolean
  focusEmptyHeading: boolean
  onSelect: (id: string) => void
  onRemoved: (library: ManagedLibrary) => void
}>) {
  if (!libraries) {
    if (stale) return null
    return (
      <Center h={200}>
        <Loader role="status" aria-label="Loading libraries" />
      </Center>
    )
  }
  if (libraries.length === 0)
    return stale ? null : <EmptyLibraries canCreate focusHeading={focusEmptyHeading} />

  const current = selectedId ? libraries.find((library) => library.id === selectedId) : libraries[0]
  return (
    <div className={styles.splitPanel} data-testid="library-workspace">
      <nav className={styles.libraryList} aria-label="Libraries to manage">
        {libraries.map((library) => (
          <button
            type="button"
            key={library.id}
            className={library.id === current?.id ? styles.selectedLibrary : styles.libraryChoice}
            aria-current={library.id === current?.id ? 'true' : undefined}
            onClick={() => onSelect(library.id)}
          >
            <Icon name={libraryIcon(library.type)} />
            <div>
              <strong>{libraryName(library)}</strong>
              <LibraryStatus status={library.administration.status} />
            </div>
            <Icon name="chevron-right" size={16} />
          </button>
        ))}
      </nav>
      {current ? (
        <LibraryDetails
          key={current.id}
          library={current}
          stale={stale}
          onRemoved={() => onRemoved(current)}
        />
      ) : (
        <div className={styles.empty}>
          <h2>Library unavailable</h2>
          <p>It may have been removed. Select another library.</p>
        </div>
      )}
    </div>
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
  const [acknowledgement, setAcknowledgement] = useState<Acknowledgement | null>(null)
  // A later run that reaches the same status belongs to someone else, so a change of status to
  // any other value ends the acknowledgement for good.
  const { administration } = library
  const [shownStatus, setShownStatus] = useState(administration.status)
  const [stopped, setStopped] = useState<StoppedRun>('unseen')
  if (shownStatus !== administration.status) {
    setShownStatus(administration.status)
    if (administration.status === 'STOPPING')
      setStopped(stoppableRun({ status: shownStatus }) ?? 'unseen')
    setAcknowledgement(
      acknowledgementAfter(acknowledgement, {
        from: shownStatus,
        to: administration.status,
        stopped,
      }),
    )
  }
  const notice = acknowledgement?.status === administration.status ? acknowledgement.text : ''
  const refreshTrigger = useRef<HTMLButtonElement>(null)
  const actionNotice = useRef<HTMLOutputElement>(null)
  const restoreRefreshFocus = useRef(false)
  const reduceMotion = useReducedMotion()
  const maintainable = canMaintainLibrary(administration)
  const disabled = stale || !maintainable || commands.pending
  const name = libraryName(library)
  const refreshId = `refresh-${library.id}`
  const running = stoppableRun(administration)
  const stopDescriptionId = `stop-${library.id}`
  const statusOutput = useRef<HTMLOutputElement>(null)
  const stopWasOffered = useRef(running !== null)
  let removalError = commands.error
  if (!removalError && stale) removalError = 'Refresh the library state before removing it.'
  if (!removalError && !maintainable)
    removalError = 'This library cannot be removed while maintenance is in progress.'

  useEffect(() => {
    // A finished request must re-enable the trigger before focus can return to it. A started
    // refresh leaves the trigger disabled, so its acknowledgement takes focus instead.
    if (!restoreRefreshFocus.current || refreshOpen || commands.pending) return
    restoreRefreshFocus.current = false
    const trigger = refreshTrigger.current
    if (trigger && !trigger.disabled) trigger.focus({ preventScroll: true })
    else actionNotice.current?.focus({ preventScroll: true })
  }, [refreshOpen, commands.pending])

  useEffect(() => {
    const stopLeft = stopWasOffered.current && running === null
    stopWasOffered.current = running !== null
    // Focus that the Stop action took with it would otherwise restart at the top of the page.
    if (stopLeft && isFocusLost()) statusOutput.current?.focus({ preventScroll: true })
  }, [running])

  // A run that already ended needs no acknowledgement: the status and last scan show its outcome.
  function acknowledge(started: ManagedLibrary, text: string) {
    if (!canMaintainLibrary(started.administration))
      setAcknowledgement({ text, status: started.administration.status })
  }

  function closeRefresh() {
    restoreRefreshFocus.current = true
    setRefreshOpen(false)
    commands.clearError()
  }

  return (
    <article className={styles.detailPane} aria-label={`${name} settings`}>
      <div className={styles.detailHeading}>
        <div className={styles.typeIcon}>
          <Icon name={libraryIcon(library.type)} label={libraryTypeLabel(library.type)} />
        </div>
        <h2>{name}</h2>
        <output ref={statusOutput} tabIndex={-1} className={styles.detailStatus}>
          <LibraryStatus status={administration.status} />
        </output>
      </div>
      <dl className={styles.metadata}>
        <div className={styles.metadataFolder}>
          <dt>Server folder</dt>
          <dd>{administration.filepathUri}</dd>
        </div>
        <div>
          <dt>Last scan</dt>
          <dd className={styles.timestamp}>{lastScanLabel(administration)}</dd>
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
              const started = await commands.refresh(library.id, imageMode)
              if (!started) return
              acknowledge(started, `Metadata refresh requested for ${name}.`)
              closeRefresh()
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
                const option = IMAGE_REFRESH_OPTIONS.find((candidate) => candidate.value === value)
                if (option) setImageMode(option.value)
              }}
              data={IMAGE_REFRESH_OPTIONS}
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
              const started = await commands.scan(library.id)
              if (started) acknowledge(started, `Scan requested for ${name}.`)
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
              if (refreshOpen) {
                closeRefresh()
                return
              }
              setImageMode('PRESERVE')
              setRefreshOpen(true)
            }}
          >
            Refresh metadata
          </Button>
          {running && (
            <Button
              variant="default"
              disabled={stale || commands.pending}
              leftSection={<Icon name="stop" />}
              aria-describedby={stopDescriptionId}
              onClick={() =>
                running === 'scan'
                  ? commands.stopScan(library.id)
                  : commands.stopRefresh(library.id)
              }
            >
              {STOP_ACTIONS[running].label}
            </Button>
          )}
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
          {!maintainable && <p>{maintenanceGuidance(administration.status)}</p>}
          {running && <p id={stopDescriptionId}>{STOP_ACTIONS[running].description}</p>}
        </div>
        {notice && (
          <output ref={actionNotice} tabIndex={-1} className={styles.actionNotice}>
            {notice}
          </output>
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
        error={removalError}
        onClose={() => {
          setRemoving(false)
          commands.clearError()
        }}
        onConfirm={async () => {
          if (disabled) return
          if (await commands.remove(library.id, onRemoved)) setRemoving(false)
        }}
      />
    </article>
  )
}
