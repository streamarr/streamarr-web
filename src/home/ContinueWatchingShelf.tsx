import { Link } from '@tanstack/react-router'
import type { HomeQuery } from '../graphql/generated/graphql'
import { ContentShelf } from '../media/ContentShelf'
import { formatTimeLeft } from '../media/formatting'
import { pickImageVariant, type PickedImage } from '../media/images'
import { StillCard } from '../media/StillCard'
import styles from './ContinueWatchingShelf.module.css'

type ContinueWatchingItem = HomeQuery['continueWatching'][number]

export function ContinueWatchingShelf({ items }: { items: ContinueWatchingItem[] }) {
  if (items.length === 0) {
    return null
  }

  return (
    <ContentShelf title="Continue watching" count={`${items.length} in progress`}>
      {items.map((item) => {
        const summary = summarize(item)
        const card = (
          <StillCard
            title={summary.title}
            subtitle={summary.subtitle}
            image={summary.image}
            blurHash={summary.blurHash}
            progressPercent={summary.progressPercent}
          />
        )
        return summary.ctaFileId ? (
          <Link
            key={item.id}
            to="/play/$mediaFileId"
            params={{ mediaFileId: summary.ctaFileId }}
            search={{ position: summary.ctaPositionSeconds ?? undefined }}
            className={styles.cardLink}
          >
            {card}
          </Link>
        ) : (
          <div key={item.id}>{card}</div>
        )
      })}
    </ContentShelf>
  )
}

function summarize(item: ContinueWatchingItem): {
  title: string
  subtitle: string
  image: PickedImage | null
  blurHash: string | null
  progressPercent: number
  ctaFileId: string | null
  ctaPositionSeconds: number | null
} {
  const timeLeft = item.watchProgress ? formatTimeLeft(item.watchProgress) : ''
  const ctaPositionSeconds = item.watchProgress?.positionSeconds || null

  if (item.__typename === 'Movie') {
    const backdrop = item.images[0] ?? null
    return {
      title: item.title ?? 'Untitled',
      subtitle: timeLeft,
      image: pickImageVariant(backdrop, 'MEDIUM'),
      blurHash: backdrop?.blurHash ?? null,
      progressPercent: item.watchProgress?.percentComplete ?? 0,
      ctaFileId: item.files[0]?.id ?? null,
      ctaPositionSeconds,
    }
  }

  const still = item.images[0] ?? null
  return {
    title: item.season.series.title ?? 'Untitled',
    subtitle: `S${item.season.seasonNumber} E${item.episodeNumber} · ${item.title ?? ''} · ${timeLeft}`,
    image: pickImageVariant(still, 'MEDIUM'),
    blurHash: still?.blurHash ?? null,
    progressPercent: item.watchProgress?.percentComplete ?? 0,
    ctaFileId: item.files[0]?.id ?? null,
    ctaPositionSeconds,
  }
}
