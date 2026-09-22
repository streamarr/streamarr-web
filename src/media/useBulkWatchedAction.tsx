import { Alert } from '@mantine/core'
import { useState } from 'react'
import {
  SeasonDetailDocument,
  type SeasonDetailQuery,
  SeriesDetailDocument,
  type SeriesDetailQuery,
} from '../graphql/generated/graphql'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { WatchedActionButton } from './WatchedActionButton'
import { useWatchedToggle } from './useWatchedToggle'
import styles from './useBulkWatchedAction.module.css'

type Series = Pick<NonNullable<SeriesDetailQuery['series']>, 'title' | 'watchStatus' | 'seasons'>
type Season = Pick<
  NonNullable<SeasonDetailQuery['season']>,
  'title' | 'seasonNumber' | 'watchStatus' | 'episodes'
>
type BulkWatchedTarget = Readonly<
  | { kind: 'series'; id: string; detail: Series | null | undefined }
  | { kind: 'season'; id: string; detail: Season | null | undefined }
>
type BulkVerb = 'watched' | 'unwatched'

export function useBulkWatchedAction(target: BulkWatchedTarget) {
  const watched = useWatchedToggle(
    target.id,
    target.kind === 'series' ? SeriesDetailDocument : SeasonDetailDocument,
  )
  const [confirming, setConfirming] = useState<BulkVerb | null>(null)
  const subject = describeTarget(target)
  if (!subject) return { action: null, feedback: null, dialog: null }

  function confirmBulk() {
    const action = confirming === 'unwatched' ? watched.markUnwatched : watched.markWatched
    setConfirming(null)
    void action()
  }

  const verb = confirming ?? 'watched'
  return {
    action: (
      <WatchedActionButton
        subject={target.kind}
        isWatched={subject.isWatched}
        pending={watched.pending}
        onClick={() => setConfirming(subject.isWatched ? 'unwatched' : 'watched')}
      />
    ),
    feedback: watched.failed && (
      <Alert color="red" role="alert" className={styles.notice}>
        Couldn't update the watched state. Try again.
      </Alert>
    ),
    dialog: (
      <ConfirmDialog
        opened={confirming !== null}
        title={`Mark ${subject.title} as ${verb}?`}
        body={`${subject.consequence} will be marked ${verb}.`}
        confirmLabel={confirming === 'unwatched' ? 'Mark unwatched' : 'Mark watched'}
        onConfirm={confirmBulk}
        onClose={() => setConfirming(null)}
      />
    ),
  }
}

function describeTarget(target: BulkWatchedTarget) {
  if (!target.detail) return null
  if (target.kind === 'series') {
    const seasons = target.detail.seasons.filter((season) => season !== null)
    const episodeCount = seasons.reduce(
      (count, season) => count + season.episodes.filter((episode) => episode !== null).length,
      0,
    )
    return {
      title: target.detail.title ?? 'Untitled',
      isWatched: target.detail.watchStatus === 'WATCHED',
      consequence: `All ${seasons.length} seasons — ${episodeCount} episodes —`,
    }
  }
  return {
    title: target.detail.title ?? `Season ${target.detail.seasonNumber}`,
    isWatched: target.detail.watchStatus === 'WATCHED',
    consequence: `All ${target.detail.episodes.filter((episode) => episode !== null).length} episodes`,
  }
}
