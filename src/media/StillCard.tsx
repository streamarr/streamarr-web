import { MediaImage } from './MediaImage'
import type { PickedImage } from './images'
import styles from './StillCard.module.css'

export function StillCard({
  title,
  subtitle,
  image,
  blurHash,
  progressPercent,
}: {
  title: string
  subtitle: string
  image: PickedImage | null
  blurHash: string | null
  progressPercent: number
}) {
  return (
    <div className={styles.stillCard}>
      <div className={styles.stillArt}>
        <MediaImage image={image} blurHash={blurHash} alt={title} />
        <div className={styles.progressTrack} aria-hidden>
          <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
        </div>
      </div>
      <div className={styles.stillTitle}>{title}</div>
      <div className={styles.stillSubtitle}>{subtitle}</div>
    </div>
  )
}
