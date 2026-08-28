import { useState } from 'react'
import { decodeBlurHashToDataUrl } from './blurhash'
import type { PickedImage } from './images'
import styles from './MediaImage.module.css'

// The base box always carries the diagonal-stripe wash as its background (MediaImage.module.css),
// so a title with neither artwork nor a blurHash still reads as an intentional placeholder.
export function MediaImage({
  image,
  blurHash,
  alt,
  className,
}: {
  image: PickedImage | null
  blurHash: string | null
  alt: string
  className?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const placeholder = blurHash ? decodeBlurHashToDataUrl(blurHash) : null

  return (
    <div className={className ? `${styles.mediaImage} ${className}` : styles.mediaImage}>
      {placeholder && !loaded && (
        <img src={placeholder} alt="" aria-hidden data-testid="blur-placeholder" className={styles.placeholder} />
      )}
      {image && (
        <img
          src={image.url}
          alt={alt}
          loading="lazy"
          className={loaded ? `${styles.image} ${styles.imageLoaded}` : styles.image}
          onLoad={() => setLoaded(true)}
        />
      )}
    </div>
  )
}
