import { useQuery } from '@apollo/client/react'
import { Alert, Center, Loader } from '@mantine/core'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { SeasonDetailDocument, type SeasonDetailQuery } from '../graphql/generated/graphql'
import { AmbientScope } from '../media/AmbientScope'
import { resolveAmbientColors } from '../media/ambientSource'
import { detailBackClass } from '../media/DetailBack'
import { detailAction, DetailHeader } from '../media/DetailHeader'
import { formatRuntime, formatTimeLeft, formatYear } from '../media/formatting'
import { BackGlyph, CheckCircleGlyph, PlayGlyph } from '../media/glyphs'
import { pickImageVariant } from '../media/images'
import { nextPlayableEpisode } from '../media/nextPlayableEpisode'
import { ProgressDivider } from '../media/ProgressDivider'
import { SeasonSideRail } from '../media/SeasonSideRail'
import { StillCard } from '../media/StillCard'
import { useWatchedToggle } from '../media/useWatchedToggle'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import styles from './SeasonDetailScreen.module.css'

type Season = NonNullable<SeasonDetailQuery['season']>
type Episode = NonNullable<Season['episodes'][number]>
type Sibling = NonNullable<Season['series']['seasons'][number]>

type BulkVerb = 'watched' | 'unwatched'

export function SeasonDetailScreen({ seasonId }: { seasonId: string }) {
  const { data, loading, error } = useQuery(SeasonDetailDocument, { variables: { id: seasonId } })
  const watched = useWatchedToggle(seasonId, SeasonDetailDocument)
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState<BulkVerb | null>(null)

  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  const season = data?.season
  if (error || !season) {
    return (
      <Alert color="red" role="alert">
        Couldn't load this season. Try again.
      </Alert>
    )
  }

  const series = season.series
  const title = season.title ?? `Season ${season.seasonNumber}`
  const episodes = season.episodes
    .filter((episode): episode is Episode => episode !== null)
    .toSorted((a, b) => a.episodeNumber - b.episodeNumber)
  const watchedCount = episodes.filter((episode) => episode.watchStatus === 'WATCHED').length
  const playable = nextPlayableEpisode([{ seasonNumber: season.seasonNumber, episodes: season.episodes }])
  const isWatched = season.watchStatus === 'WATCHED'
  // A season rarely has a backdrop of its own; the series' keeps the tint consistent across pages.
  const artwork = season.backdropImages[0] ?? series.backdropImages[0] ?? season.posterImages[0] ?? null
  const ambient = resolveAmbientColors(season.backdropImages, series.backdropImages, season.posterImages)
  const siblings = series.seasons
    .filter((sibling): sibling is Sibling => sibling !== null)
    .toSorted((a, b) => a.seasonNumber - b.seasonNumber)
    .map((sibling) => ({
      id: sibling.id,
      label: sibling.title ?? `Season ${sibling.seasonNumber}`,
      unwatchedCount: sibling.episodes.filter((episode) => episode && episode.watchStatus !== 'WATCHED').length,
    }))

  function confirmBulk() {
    const action = confirming === 'unwatched' ? watched.markUnwatched : watched.markWatched
    setConfirming(null)
    void action()
  }

  return (
    <AmbientScope theme={ambient?.theme ?? null}>
      <DetailHeader
        titleColumn
        backdrop={{
          image: pickImageVariant(artwork, 'LARGE'),
          blurHash: artwork?.blurHash ?? null,
          corners: ambient,
          height: 360,
        }}
        back={
          <Link to="/series/$seriesId" params={{ seriesId: series.id }} className={detailBackClass}>
            <BackGlyph />
            {series.title ?? 'Series'}
          </Link>
        }
        metadata={[
          { label: 'Created by', value: names(series.directors) },
          { label: 'First aired', value: formatYear(season.airDate) },
          { label: 'Episodes', value: episodes.length > 0 ? String(episodes.length) : null },
          { label: 'Rating', value: series.contentRating?.value ?? null },
        ]}
        eyebrow={series.title ?? undefined}
        title={title}
        synopsis={season.overview}
        actions={
          <>
            {playable?.fileId && (
              <Link
                to="/play/$mediaFileId"
                params={{ mediaFileId: playable.fileId }}
                search={{ position: playable.positionSeconds ?? undefined }}
                className={detailAction.primary}
              >
                <PlayGlyph />
                {playable.verb} E{playable.episodeNumber}
              </Link>
            )}
            <button
              type="button"
              className={detailAction.outline}
              disabled={watched.pending}
              onClick={() => setConfirming(isWatched ? 'unwatched' : 'watched')}
            >
              <CheckCircleGlyph />
              {isWatched ? 'Mark season unwatched' : 'Mark season watched'}
            </button>
          </>
        }
      />
      {watched.failed && (
        <Alert color="red" role="alert" className={styles.notice}>
          Couldn't update the watched state. Try again.
        </Alert>
      )}
      <ProgressDivider watched={watchedCount} total={episodes.length} />
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Episodes</h2>
        <div className={styles.body}>
          <SeasonSideRail
            seasons={siblings}
            selectedId={season.id}
            onSelect={(id) => void navigate({ to: '/season/$seasonId', params: { seasonId: id } })}
          />
          <div className={styles.grid}>
            {episodes.map((episode) => {
              const still = episode.stillImages[0] ?? null
              const fileId = episode.files[0]?.id ?? null
              const card = (
                <StillCard
                  layout="grid"
                  title={`E${episode.episodeNumber} — ${episode.title ?? ''}`}
                  subtitle={episodeSubtitle(episode)}
                  image={pickImageVariant(still, 'MEDIUM')}
                  blurHash={still?.blurHash ?? null}
                  badge={episode.watchStatus === 'WATCHED' ? { status: 'watched' } : undefined}
                  progressPercent={episode.watchProgress?.percentComplete ?? undefined}
                />
              )
              // Clicking an episode plays it directly; there is no episode page on web.
              return fileId ? (
                <Link
                  key={episode.id}
                  to="/play/$mediaFileId"
                  params={{ mediaFileId: fileId }}
                  search={{ position: episode.watchProgress?.positionSeconds || undefined }}
                  className={styles.cardLink}
                >
                  {card}
                </Link>
              ) : (
                <div key={episode.id}>{card}</div>
              )
            })}
          </div>
        </div>
      </section>
      <ConfirmDialog
        opened={confirming !== null}
        title={`Mark ${title} as ${confirming ?? 'watched'}?`}
        body={`All ${episodes.length} episodes will be marked ${confirming ?? 'watched'}.`}
        confirmLabel={confirming === 'unwatched' ? 'Mark unwatched' : 'Mark watched'}
        onConfirm={confirmBulk}
        onClose={() => setConfirming(null)}
      />
    </AmbientScope>
  )
}

// One progress readout per surface: time left while mid-watch, otherwise the runtime.
function episodeSubtitle(episode: Episode): string {
  if (episode.watchProgress && episode.watchProgress.positionSeconds > 0) {
    return formatTimeLeft(episode.watchProgress)
  }
  return episode.runtime != null ? formatRuntime(episode.runtime) : ''
}

function names(people: ReadonlyArray<{ name: string } | null>): string | null {
  const present = people.filter((entry): entry is { name: string } => entry !== null).map((entry) => entry.name)
  return present.length > 0 ? present.join(', ') : null
}
