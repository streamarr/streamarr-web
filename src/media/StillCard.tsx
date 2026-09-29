import { MediaImage } from './MediaImage'
import type { PickedImage } from './images'
import styles from './StillCard.module.css'
import { WatchedBadge, type WatchedBadgeProps } from './WatchedBadge'

// Shelf layout is the fixed 444×250 continue-watching card; grid layout fills its column at 16:9
// for the season's episode grid.
export function StillCard({
  title,
  subtitle,
  image,
  blurHash,
  badge,
  layout = 'shelf',
}: Readonly<{
  title: string
  subtitle: string
  image: PickedImage | null
  blurHash: string | null
  badge?: WatchedBadgeProps
  layout?: 'shelf' | 'grid'
}>) {
  return (
    <div className={layout === 'grid' ? `${styles.stillCard} ${styles.grid}` : styles.stillCard}>
      <div className={styles.stillArt}>
        <MediaImage image={image} blurHash={blurHash} alt={title} />
        {badge && <WatchedBadge {...badge} />}
      </div>
      <div className={styles.stillTitle}>{title}</div>
      <div className={styles.stillSubtitle}>{subtitle}</div>
    </div>
  )
}
