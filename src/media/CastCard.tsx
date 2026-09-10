import styles from './CastCard.module.css'
import type { PickedImage } from './images'
import { MediaImage } from './MediaImage'

// The schema carries no character name, so the card is the portrait and the person's name.
export function CastCard({ name, image, blurHash }: { name: string; image: PickedImage | null; blurHash: string | null }) {
  return (
    <div className={styles.card}>
      <div className={styles.portrait}>
        <MediaImage image={image} blurHash={blurHash} alt={name} />
      </div>
      <div className={styles.name}>{name}</div>
    </div>
  )
}
