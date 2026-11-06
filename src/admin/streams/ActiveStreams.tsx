import { Alert, Center, Loader } from '@mantine/core'
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type {
  ActiveStreamFieldsFragment,
  PlaybackDecisionFieldsFragment,
  PlaybackState,
} from '../../graphql/generated/graphql'
import { isForbidden } from '../../graphql/errorRouting'
import { requestFailureMessage } from '../../graphql/requestErrors'
import filterStyles from '../../library/FilterBar.module.css'
import sortStyles from '../../library/SortMenu.module.css'
import { formatTimecode } from '../../media/formatting'
import { PosterCard } from '../../media/PosterCard'
import { moveBetweenRows } from '../../streaming/CaretPopover'
import { Fact, Facts, PlaybackDecisionTracks } from '../../streaming/PlaybackDecisionFacts'
import { bitrateText, placedReasons } from '../../streaming/playbackDecisionText'
import { FailurePanel, FailureRow } from '../../ui/Failure'
import { Icon, type IconName } from '../../ui/Icon'
import { initials } from '../../ui/ProfileTile'
import settingsStyles from '../Settings.module.css'
import styles from './ActiveStreams.module.css'
import type { LiveStreamsStop } from './activeStreamsList'
import {
  episodeLine,
  KIND_LABELS,
  kindCounts,
  type KindFilter,
  producedSpan,
  progressPercent,
  outputBitrate,
  SORT_LABELS,
  type StreamKind,
  streamKind,
  streamPoster,
  type StreamSort,
  streamTitle,
  outputTotal,
  viewerName,
  visibleStreams,
  workerNames,
} from './activeStreamsView'
import { useActiveStreams } from './useActiveStreams'

type Stream = ActiveStreamFieldsFragment

const LIVE_STOP_MESSAGES = {
  forbidden: 'You no longer have permission to see active streams.',
  failed: 'Live updates stopped. Reload the page to see the latest streams.',
} as const satisfies Record<LiveStreamsStop, string>

const KINDS: StreamKind[] = ['DIRECT_PLAY', 'COPY', 'ENCODE', 'PREPARING']

type KnownState = Exclude<PlaybackState, '%future added value'>

const STATE_LABELS: Record<KnownState, string> = {
  PLAYING: 'Playing',
  PAUSED: 'Paused',
  STOPPED: 'Stopped',
}

const STATE_ICONS: Record<KnownState, IconName> = {
  PLAYING: 'play',
  PAUSED: 'pause',
  STOPPED: 'stop',
}

// A state newer than the pinned schema is left unsaid rather than shown as one the page knows.
function knownState({ state }: Stream): KnownState | null {
  return state !== null && Object.hasOwn(STATE_LABELS, state) ? (state as KnownState) : null
}

/** Every stream that plays on the server now, one poster each, kept current as streams change. */
export function ActiveStreams() {
  const { streams, failure, liveStop, retry } = useActiveStreams()

  if (failure && isForbidden(failure))
    return (
      <Alert role="alert">
        Active streams are available to server admins using an account session.
      </Alert>
    )

  const all = streams ? [...streams.values()] : null
  return (
    <>
      <StreamsHeading streams={all ?? []} />
      {liveStop && (
        <Alert role="alert" color="red" mb="md">
          {LIVE_STOP_MESSAGES[liveStop]}
        </Alert>
      )}
      <StreamList streams={all} failure={failure} onRetry={retry} />
    </>
  )
}

function StreamsHeading({ streams }: Readonly<{ streams: readonly Stream[] }>) {
  const summary = summaryText(streams)
  return (
    <div className={`${settingsStyles.pageHeading} ${styles.pageHeading}`}>
      <h1>
        Active streams
        {streams.length > 0 && (
          <span className={settingsStyles.libraryCount}>{streams.length}</span>
        )}
      </h1>
      {summary && <p className={styles.summary}>{summary}</p>}
    </div>
  )
}

function summaryText(streams: readonly Stream[]): string {
  const counts = kindCounts(streams)
  const kinds = (['DIRECT_PLAY', 'COPY', 'ENCODE'] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${counts[kind]} ${KIND_LABELS[kind].toLowerCase()}`)
  const total = outputTotal(streams)
  return [total !== null && `Output up to ${bitrateText(total)}`, kinds.join(', ')]
    .filter(Boolean)
    .join(' · ')
}

function StreamList({
  streams,
  failure,
  onRetry,
}: Readonly<{
  streams: readonly Stream[] | null
  failure: unknown
  onRetry: () => Promise<void>
}>) {
  if (!streams && failure)
    return (
      <FailurePanel onRetry={onRetry}>
        {requestFailureMessage(failure, "Couldn't load the active streams.")}
      </FailurePanel>
    )
  if (!streams)
    return (
      <Center h={200}>
        <Loader role="status" aria-label="Loading the active streams" />
      </Center>
    )

  return (
    <>
      {failure && (
        <FailureRow className={settingsStyles.failureRow} onRetry={onRetry}>
          {requestFailureMessage(failure, "Couldn't load the latest streams.")}
        </FailureRow>
      )}
      {streams.length === 0 ? (
        <p className={styles.empty}>Nothing is playing right now.</p>
      ) : (
        <StreamWall streams={streams} />
      )}
    </>
  )
}

function StreamWall({ streams }: Readonly<{ streams: readonly Stream[] }>) {
  const [kind, setKind] = useState<KindFilter>('ALL')
  const [worker, setWorker] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<StreamSort>('VIEWER')
  const shown = visibleStreams(streams, { kind, worker, query, sort })
  const counts = kindCounts(streams)
  // A delivery with no streams has no chip (principle 7.1); the chosen one stays until cleared.
  const presentKinds = KINDS.filter((each) => counts[each] > 0 || kind === each)

  return (
    <>
      <div className={`${filterStyles.filterBar} ${styles.toolbar}`}>
        <div className={styles.filters}>
          <KindChips kinds={presentKinds} total={streams.length} kind={kind} onChange={setKind} />
          <span className={styles.divider} aria-hidden="true" />
          <ChipMenu
            label="Worker"
            triggerText={worker ?? 'Any worker'}
            active={worker !== null}
            options={[
              { value: null, label: 'Any worker' },
              ...workerNames(streams).map((name) => ({ value: name, label: name })),
            ]}
            value={worker}
            onChange={setWorker}
          />
        </div>
        <div className={styles.tools}>
          <input
            className={styles.search}
            type="search"
            placeholder="Search"
            aria-label="Search viewers, titles and devices"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <ChipMenu
            label="Sort"
            triggerText={`Sort: ${SORT_LABELS[sort]}`}
            align="end"
            options={(Object.keys(SORT_LABELS) as StreamSort[]).map((value) => ({
              value,
              label: SORT_LABELS[value],
            }))}
            value={sort}
            onChange={setSort}
          />
        </div>
      </div>
      {shown.length === 0 ? (
        <p className={styles.empty}>No stream matches.</p>
      ) : (
        <PosterGrid streams={shown} />
      )}
    </>
  )
}

/**
 * The delivery chips that fit the bar's width; the rest fold into an "N more" menu, which takes
 * the chosen delivery's name when the chosen one is folded away.
 */
function KindChips({
  kinds,
  total,
  kind,
  onChange,
}: Readonly<{
  kinds: readonly StreamKind[]
  total: number
  kind: KindFilter
  onChange: (kind: KindFilter) => void
}>) {
  const row = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const fit = useFittingCount(row, measure, kinds.length, `${kinds.join()}|${total}`)
  const shown = kinds.slice(0, fit)
  const folded = kinds.slice(fit)
  const chosenFolded = kind !== 'ALL' && folded.includes(kind)
  const allChip = (
    <KindChip label="All" pressed={kind === 'ALL'} onPress={() => onChange('ALL')}>
      {' '}
      <span className={filterStyles.count}>{total}</span>
    </KindChip>
  )

  return (
    <div ref={row} className={styles.kindChips}>
      <div ref={measure} className={styles.measure} aria-hidden="true" inert>
        {allChip}
        {kinds.map((each) => (
          <KindChip key={each} label={KIND_LABELS[each]} pressed={false} onPress={() => {}} />
        ))}
        <span className={filterStyles.chip}>
          <span className={styles.chipMenuText}>
            {kinds.length} more
            <Icon name="chevron-down" size={14} />
          </span>
        </span>
      </div>
      {allChip}
      {shown.map((each) => (
        <KindChip
          key={each}
          label={KIND_LABELS[each]}
          pressed={kind === each}
          onPress={() => onChange(each)}
        />
      ))}
      {folded.length > 0 && (
        <ChipMenu
          label="More deliveries"
          triggerText={chosenFolded ? KIND_LABELS[kind] : `${folded.length} more`}
          active={chosenFolded}
          options={folded.map((each) => ({ value: each, label: KIND_LABELS[each] }))}
          value={kind}
          onChange={onChange}
        />
      )}
    </div>
  )
}

/**
 * How many of `count` measured chips fit beside the first one in the space the row's parent
 * leaves it, keeping room for the "more" chip whenever any are left out. The measure box holds the
 * first chip, then each chip, then the "more" chip.
 */
function useFittingCount(
  row: RefObject<HTMLElement | null>,
  measure: RefObject<HTMLElement | null>,
  count: number,
  contentKey: string,
): number {
  const [fit, setFit] = useState(count)
  useLayoutEffect(() => {
    const rowElement = row.current
    const host = rowElement?.parentElement
    if (!rowElement || !host) return
    const update = () => {
      if (!measure.current) return
      setFit(fittingCount(rowElement, host, measure.current))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [row, measure, contentKey])
  return fit
}

function fittingCount(row: HTMLElement, host: HTMLElement, measure: HTMLElement): number {
  const gap = Number.parseFloat(getComputedStyle(host).columnGap) || 0
  const siblings = [...host.children].filter((child) => child !== row) as HTMLElement[]
  const taken = siblings.reduce((sum, sibling) => sum + sibling.offsetWidth + gap, 0)
  const available = host.clientWidth - taken
  const widths = [...measure.children].map((child) => (child as HTMLElement).offsetWidth)
  const more = widths.pop() ?? 0
  const [first = 0, ...chips] = widths
  let used = first
  let fit = 0
  for (const [index, width] of chips.entries()) {
    const left = chips.length - index - 1
    const needed = used + gap + width + (left > 0 ? gap + more : 0)
    if (needed > available) break
    used += gap + width
    fit += 1
  }
  return fit
}

function KindChip({
  label,
  pressed,
  onPress,
  children,
}: Readonly<{
  label: string
  pressed: boolean
  onPress: () => void
  children?: ReactNode
}>) {
  return (
    <button
      type="button"
      className={pressed ? `${filterStyles.chip} ${filterStyles.chipActive}` : filterStyles.chip}
      aria-pressed={pressed}
      onClick={onPress}
    >
      {label}
      {children}
    </button>
  )
}

function ChipMenu<Value extends string | null>({
  label,
  triggerText,
  options,
  value,
  onChange,
  active = false,
  align = 'start',
}: Readonly<{
  label: string
  triggerText: string
  options: { value: Value; label: string }[]
  value: Value
  onChange: (value: Value) => void
  active?: boolean
  align?: 'start' | 'end'
}>) {
  const [opened, setOpened] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()

  // Escape and a choice hand focus back to the button; a click elsewhere keeps it where it landed.
  const close = useCallback(({ returnFocus }: { returnFocus: boolean }) => {
    setOpened(false)
    if (returnFocus) trigger.current?.focus()
  }, [])

  useDismiss(anchor, opened, close)
  useLayoutEffect(() => {
    if (!opened) return
    const rows = Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [],
    )
    const checked = rows.find((row) => row.getAttribute('aria-checked') === 'true')
    ;(checked ?? rows[0])?.focus()
  }, [opened])

  return (
    <div className={sortStyles.anchor} ref={anchor}>
      <button
        ref={trigger}
        type="button"
        className={active ? `${filterStyles.chip} ${filterStyles.chipActive}` : filterStyles.chip}
        aria-expanded={opened}
        aria-controls={opened ? menuId : undefined}
        onClick={() => setOpened((open) => !open)}
      >
        <span className={styles.chipMenuText}>
          {triggerText}
          <Icon name="chevron-down" size={14} />
        </span>
      </button>
      {opened && (
        <div
          ref={menu}
          id={menuId}
          className={align === 'start' ? `${sortStyles.menu} ${styles.menuStart}` : sortStyles.menu}
          role="menu"
          aria-label={label}
        >
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              tabIndex={-1}
              className={
                option.value === value
                  ? `${sortStyles.item} ${sortStyles.itemActive}`
                  : sortStyles.item
              }
              onClick={() => {
                onChange(option.value)
                close({ returnFocus: true })
              }}
              onKeyDown={moveBetweenRows}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function useDismiss(
  anchor: RefObject<HTMLElement | null>,
  opened: boolean,
  close: (options: { returnFocus: boolean }) => void,
) {
  useEffect(() => {
    if (!opened) return
    function onPointerDown(event: MouseEvent) {
      if (anchor.current && !anchor.current.contains(event.target as Node))
        close({ returnFocus: false })
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close({ returnFocus: true })
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [anchor, opened, close])
}

function PosterGrid({ streams }: Readonly<{ streams: readonly Stream[] }>) {
  const grid = useRef<HTMLDivElement>(null)
  const columns = useGridColumns(grid)
  const [openId, setOpenId] = useState<string | null>(null)
  const detailId = useId()
  const cards = useRef(new Map<string, HTMLButtonElement>())
  // The element inside the details that last held focus, until focus leaves them.
  const detailFocus = useRef<HTMLElement | null>(null)
  const lastOpenIndex = useRef(-1)
  const openIndex = streams.findIndex((stream) => stream.playbackSessionId === openId)
  const rowEnd = Math.min(streams.length, (Math.floor(openIndex / columns) + 1) * columns) - 1
  const detailAfter = openIndex < 0 ? -1 : rowEnd

  // When the open stream ends while its details hold focus, focus goes to the card in its place.
  useLayoutEffect(() => {
    if (openIndex >= 0) {
      lastOpenIndex.current = openIndex
      return
    }
    if (!detailFocus.current) return
    detailFocus.current = null
    const next = streams[Math.min(lastOpenIndex.current, streams.length - 1)]
    if (next) cards.current.get(next.playbackSessionId)?.focus()
  }, [openIndex, streams])

  function close() {
    const card = openId ? cards.current.get(openId) : undefined
    detailFocus.current = null
    setOpenId(null)
    card?.focus()
  }

  function toggle(id: string) {
    setOpenId((open) => (open === id ? null : id))
  }

  // The details are a sibling keyed by their stream, so a card that starts or ends in the row
  // moves them rather than mounting them afresh.
  const items: ReactNode[] = []
  streams.forEach((stream, index) => {
    items.push(
      <StreamCard
        key={stream.playbackSessionId}
        stream={stream}
        open={stream.playbackSessionId === openId}
        detailId={detailId}
        register={(element) => {
          if (element) cards.current.set(stream.playbackSessionId, element)
          else cards.current.delete(stream.playbackSessionId)
        }}
        onToggle={() => toggle(stream.playbackSessionId)}
      />,
    )
    if (index !== detailAfter) return
    items.push(
      <StreamDetail
        key={`detail-${streams[openIndex].playbackSessionId}`}
        id={detailId}
        stream={streams[openIndex]}
        caretColumn={openIndex % columns}
        columns={columns}
        focusMemoryRef={detailFocus}
        onClose={close}
      />,
    )
  })

  return (
    <div ref={grid} className={styles.grid} data-testid="stream-grid">
      {items}
    </div>
  )
}

function StreamCard({
  stream,
  open,
  detailId,
  register,
  onToggle,
}: Readonly<{
  stream: Stream
  open: boolean
  detailId: string
  register: (element: HTMLButtonElement | null) => void
  onToggle: () => void
}>) {
  const { image, blurHash } = streamPoster(stream)
  const kind = streamKind(stream)
  const state = knownState(stream)
  const viewer = viewerName(stream)
  return (
    <button
      ref={register}
      type="button"
      className={styles.card}
      aria-expanded={open}
      aria-controls={open ? detailId : undefined}
      aria-label={cardLabel(stream)}
      onClick={onToggle}
    >
      <PosterCard
        title={streamTitle(stream)}
        meta={episodeLine(stream) ?? ''}
        image={image}
        blurHash={blurHash}
        overlay={
          <>
            <span className={styles.badges}>
              {kind && <span className={styles.badge}>{KIND_LABELS[kind]}</span>}
              {state && (
                <span className={styles.glyph} data-state={state}>
                  <Icon name={STATE_ICONS[state]} size={14} />
                </span>
              )}
            </span>
            <span className={styles.viewer}>
              <span className={styles.viewerMark}>{initials(viewer)}</span>
              <span className={styles.viewerName}>{viewer}</span>
            </span>
            <PositionTrack stream={stream} />
          </>
        }
      />
    </button>
  )
}

// The produced stretch sits behind the position, so an encode that runs ahead shows its lead.
function PositionTrack({ stream }: Readonly<{ stream: Stream }>) {
  const percent = progressPercent(stream)
  if (percent === null) return null
  const produced = producedSpan(stream)
  return (
    <span
      className={styles.track}
      role="progressbar"
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
    >
      {produced && (
        <span
          className={styles.produced}
          data-testid="produced-range"
          style={{ left: `${produced.left}%`, width: `${produced.width}%` }}
        />
      )}
      <span className={styles.played} style={{ width: `${percent}%` }} />
    </span>
  )
}

function cardLabel(stream: Stream): string {
  const episode = episodeLine(stream)
  const title = episode ? `${streamTitle(stream)}, ${episode}` : streamTitle(stream)
  // A stream that prepares has neither a state nor a delivery yet, so it says Preparing once.
  const kind = streamKind(stream)
  const status = [...new Set([stateText(stream), kind && KIND_LABELS[kind]])]
    .filter(Boolean)
    .join(', ')
  return `${title}, ${viewerName(stream)}. ${status}.`
}

function stateText(stream: Stream): string | null {
  if (stream.state === null) return 'Preparing'
  const state = knownState(stream)
  return state && STATE_LABELS[state]
}

function StreamDetail({
  id,
  stream,
  caretColumn,
  columns,
  focusMemoryRef,
  onClose,
}: Readonly<{
  id: string
  stream: Stream
  caretColumn: number
  columns: number
  focusMemoryRef: RefObject<HTMLElement | null>
  onClose: () => void
}>) {
  const titleId = useId()
  const panel = useRef<HTMLElement>(null)
  const episode = episodeLine(stream)
  useLayoutEffect(() => {
    panel.current?.scrollIntoView?.({ block: 'nearest' })
  }, [stream.playbackSessionId])
  // Moving the details in the page drops focus without a blur; hand it back to where it was.
  useLayoutEffect(() => {
    const focused = focusMemoryRef.current
    if (focused?.isConnected && document.activeElement === document.body) focused.focus()
  })

  return (
    <section
      ref={panel}
      id={id}
      className={styles.detail}
      aria-labelledby={titleId}
      style={{ '--caret-left': caretLeft(caretColumn, columns) } as CSSProperties}
      onFocus={(event) => {
        focusMemoryRef.current = event.target
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) focusMemoryRef.current = null
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <span className={styles.caret} aria-hidden="true" />
      <div className={styles.detailClip}>
        <div className={styles.detailPanel}>
          <div className={styles.detailHead}>
            <div className={styles.detailTitles}>
              <h2 id={titleId} className={styles.detailTitle}>
                {streamTitle(stream)}
              </h2>
              {episode && <span className={styles.detailSub}>{episode}</span>}
            </div>
            <button
              type="button"
              className={styles.close}
              aria-label="Close details"
              onClick={onClose}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className={styles.detailBody}>
            <div className={styles.detailFacts}>
              <Facts>
                <Fact name="Viewer" value={viewerName(stream)} />
                <Fact name="Device" value={stream.deviceName ?? 'Not named'} />
                <Fact name="Position" value={positionText(stream)} />
                {stream.producedRange && (
                  <Fact name="Produced" value={producedText(stream.producedRange)} />
                )}
                <Fact name="Output bitrate" value={outputBitrateText(stream)} />
                <Fact name="Workers" value={stream.workers.join(', ') || 'None'} />
              </Facts>
            </div>
            <span className={styles.rule} aria-hidden="true" />
            <div className={styles.tracks}>
              {stream.decision ? (
                <StreamDecision decision={stream.decision} />
              ) : (
                <p className={styles.waiting}>The tracks appear once the stream starts.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// The open card's centre: each column's width is the grid's width less its column gaps.
function caretLeft(column: number, columns: number): string {
  const gap = 'var(--spacing-20)'
  return `calc((100% - ${columns - 1} * ${gap}) / ${columns} * ${column + 0.5} + ${column} * ${gap})`
}

function useGridColumns(grid: RefObject<HTMLElement | null>): number {
  const [columns, setColumns] = useState(1)
  useLayoutEffect(() => {
    const element = grid.current
    if (!element) return
    const measure = () => {
      const tracks = getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean)
      setColumns(Math.max(1, tracks.length))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [grid])
  return columns
}

// An active stream carries no requested playback choice, so the reasons name the viewer instead.
function StreamDecision({ decision }: Readonly<{ decision: PlaybackDecisionFieldsFragment }>) {
  const reasons = placedReasons({ decision, requestedChoice: null })
  return (
    <>
      {reasons.stream.length > 0 && (
        <ul className={styles.streamReasons} aria-label="Stream reasons">
          {reasons.stream.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <PlaybackDecisionTracks decision={decision} reasons={reasons} />
    </>
  )
}

function positionText(stream: Stream): string {
  const { positionSeconds, state } = stream
  if (positionSeconds === null || state === null) return 'Preparing'
  const position = formatTimecode({ positionSeconds, durationSeconds: positionSeconds })
  return [position, stateText(stream)].filter(Boolean).join(' · ')
}

function producedText({ startSeconds, endSeconds }: NonNullable<Stream['producedRange']>): string {
  const timecode = (seconds: number) =>
    formatTimecode({ positionSeconds: seconds, durationSeconds: endSeconds })
  return `${timecode(startSeconds)} to ${timecode(endSeconds)}`
}

function outputBitrateText(stream: Stream): string {
  const sent = outputBitrate(stream)
  return sent === null ? 'Not known' : bitrateText(sent)
}
