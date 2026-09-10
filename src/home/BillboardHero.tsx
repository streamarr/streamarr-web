import { Link } from '@tanstack/react-router'
import { MediaImage } from '../media/MediaImage'
import type { BillboardContent } from './billboardContent'
import styles from './BillboardHero.module.css'

// No Trailer / More info / watchlist chips: none has a backing capability yet (no trailer URL in
// the schema, no Detail route, no watchlist mutation) — a single primary CTA only.
export function BillboardHero({ content }: { content: BillboardContent }) {
  return (
    <div className={styles.hero}>
      <MediaImage image={content.backdrop} blurHash={content.blurHash} alt="" className={styles.backdrop} />
      <div className={styles.scrim} aria-hidden />
      <div className={styles.panel}>
        {content.tagline && <p className={styles.tagline}>{content.tagline}</p>}
        <h1 className={styles.title}>{content.title}</h1>
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
            search={{ position: content.ctaPositionSeconds ?? undefined }}
            className={styles.cta}
          >
            {content.ctaLabel}
          </Link>
        )}
      </div>
    </div>
  )
}
