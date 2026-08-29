import type { CSSProperties, ReactNode } from 'react'
import styles from './BackdropHero.module.css'
import type { PickedImage } from './images'
import { MediaImage } from './MediaImage'

export interface AmbientCorners {
  topLeft: string
  topRight: string
  bottomRight: string
  bottomLeft: string
}

// The backdrop layer only; DetailHeader composes it with the title block and actions.
export function BackdropHero({
  image,
  blurHash,
  corners,
  height,
  alt,
  back,
  metadata,
}: {
  image: PickedImage | null
  blurHash: string | null
  corners: AmbientCorners | null
  height: number
  alt: string
  back?: ReactNode
  metadata?: ReactNode
}) {
  return (
    <div className={styles.hero} style={{ height }} data-testid="backdrop-hero">
      <MediaImage image={image} blurHash={blurHash} alt={alt} className={styles.artwork} />
      {corners && <div className={styles.cornerHint} style={cornerVariables(corners)} data-testid="corner-hint" aria-hidden />}
      <div className={styles.fade} aria-hidden />
      {back && <div className={styles.back}>{back}</div>}
      {metadata && <div className={styles.metadata}>{metadata}</div>}
    </div>
  )
}

function cornerVariables(corners: AmbientCorners): CSSProperties {
  return {
    '--corner-top-left': corners.topLeft,
    '--corner-top-right': corners.topRight,
    '--corner-bottom-right': corners.bottomRight,
    '--corner-bottom-left': corners.bottomLeft,
  } as CSSProperties
}
