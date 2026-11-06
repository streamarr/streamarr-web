import { Link } from '@tanstack/react-router'
import type { CSSProperties } from 'react'
import { MediaImage } from '../media/MediaImage'
import type { BillboardContent } from './billboardContent'
import styles from './BillboardHero.module.css'

// No Trailer / More info / watchlist chips: none has a backing capability yet (no trailer URL in
// the schema, no Detail route, no watchlist mutation) — a single primary CTA only.
export function BillboardHero({ content }: Readonly<{ content: BillboardContent }>) {
  return (
    <div className={styles.hero} style={accentVariables(content)} data-testid="billboard-hero">
      <MediaImage
        image={content.backdrop}
        blurHash={content.blurHash}
        alt=""
        className={styles.backdrop}
      />
      <div className={styles.scrim} aria-hidden />
      <div className={styles.panel}>
        <h1 className={styles.title}>{content.title}</h1>
        {content.tagline && <p className={styles.tagline}>{content.tagline}</p>}
        <div className={styles.metadata}>
          {content.metadata.map((entry) => (
            <span key={entry.label}>
              <span className={styles.metadataLabel}>{entry.label}: </span>
              {entry.value}
            </span>
          ))}
        </div>
        {content.synopsis && <p className={styles.synopsis}>{content.synopsis}</p>}
        {content.ctaFileId && (
          <Link
            to="/play/$mediaFileId"
            params={{ mediaFileId: content.ctaFileId }}
            search={{
              ...content.ctaMediaTitle,
              position: content.ctaPositionSeconds ?? undefined,
            }}
            className={styles.cta}
          >
            {content.ctaLabel}
          </Link>
        )}
      </div>
    </div>
  )
}

// The primary action takes the featured title's accent; without one it keeps the neutral
// selection color (principle 10.3). Only the action reads these, so Home itself stays neutral.
function accentVariables({ ambientTheme }: BillboardContent): CSSProperties | undefined {
  if (!ambientTheme) {
    return undefined
  }
  return {
    '--ambient-accent': ambientTheme.accent,
    '--ambient-on-accent': ambientTheme.onAccent,
  } as CSSProperties
}
