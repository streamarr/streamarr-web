import type { ReactNode } from 'react'
import { MediaImage } from './MediaImage'
import type { PickedImage } from './images'
import styles from './PosterCard.module.css'
import { WatchedBadge, type WatchedBadgeProps } from './WatchedBadge'

// No navigation prop on purpose: callers wrap this in a <Link> to whichever detail page fits.
export function PosterCard({
  title,
  meta,
  image,
  blurHash,
  badge,
  progressPercent,
  imageLoading,
  overlay,
}: Readonly<{
  title: string
  meta: string
  image: PickedImage | null
  blurHash: string | null
  badge?: WatchedBadgeProps
  progressPercent?: number
  imageLoading?: 'lazy' | 'eager'
  overlay?: ReactNode
}>) {
  return (
    <div className={styles.posterCard}>
      <div className={styles.posterArt}>
        <MediaImage image={image} blurHash={blurHash} alt={title} loading={imageLoading} />
        {overlay}
        {badge && <WatchedBadge {...badge} />}
        {progressPercent != null && progressPercent > 0 && (
          <WatchedBadge status="in-progress" percentComplete={progressPercent} />
        )}
      </div>
      <div className={styles.posterTitle} data-testid="poster-title">
        {title}
      </div>
      <div className={styles.posterMeta}>{meta}</div>
    </div>
  )
}
