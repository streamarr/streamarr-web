import { Fragment, type ReactNode } from 'react'
import { BackdropHero, type AmbientCorners } from './BackdropHero'
import styles from './DetailHeader.module.css'
import type { PickedImage } from './images'
import { MetadataColumns, type MetadataEntry } from './MetadataColumns'

export interface DetailBackdrop {
  image: PickedImage | null
  blurHash: string | null
  corners: AmbientCorners | null
  height: number
}

// Class names for the header's action row: one accent-filled primary verb, washes for the rest.
export const detailAction = {
  primary: `${styles.action} ${styles.primary}`,
  secondary: `${styles.action} ${styles.secondary}`,
  outline: `${styles.action} ${styles.outline}`,
}

export function DetailHeader({
  backdrop,
  back,
  metadata,
  eyebrow,
  title,
  tagline,
  metaLine,
  synopsis,
  actions,
  aside,
  titleColumn = false,
}: {
  backdrop: DetailBackdrop
  back?: ReactNode
  metadata: MetadataEntry[]
  eyebrow?: string
  title: string
  tagline?: string | null
  metaLine?: string[]
  synopsis?: string | null
  actions: ReactNode
  aside?: ReactNode
  titleColumn?: boolean
}) {
  return (
    <header className={styles.header}>
      <BackdropHero {...backdrop} alt="" back={back} metadata={<MetadataColumns entries={metadata} />} />
      <div className={titleColumn ? `${styles.panel} ${styles.split}` : styles.panel}>
        <div className={styles.main}>
          <div className={styles.heading}>
            {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
            {tagline && <p className={styles.tagline}>{tagline}</p>}
            <h1 className={styles.title}>{title}</h1>
          </div>
          <div className={styles.body}>
            {metaLine && metaLine.length > 0 && (
              <div className={styles.metaLine}>
                {metaLine.map((entry, index) => (
                  <Fragment key={entry}>
                    {index > 0 && (
                      <span aria-hidden="true" className={styles.dot}>
                        •
                      </span>
                    )}
                    <span>{entry}</span>
                  </Fragment>
                ))}
              </div>
            )}
            {synopsis && <p className={styles.synopsis}>{synopsis}</p>}
            {actions && <div className={styles.actions}>{actions}</div>}
          </div>
        </div>
        {aside && <div className={styles.aside}>{aside}</div>}
      </div>
    </header>
  )
}
