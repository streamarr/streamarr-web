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
  /** A quieter run after an action's verb, such as Resume's time left. */
  detail: styles.actionDetail,
}

/** How much of a title has been watched, along the foot of its Resume action. */
export function ActionProgress({ share }: Readonly<{ share: number }>) {
  const watched = Math.min(Math.max(share, 0), 1)
  return (
    <span className={styles.progress} aria-hidden>
      <span
        className={styles.progressFill}
        style={{ width: `${watched * 100}%` }}
        data-testid="action-progress"
      />
    </span>
  )
}

export function DetailHeader({
  backdrop,
  back,
  endsIn,
  metadata,
  eyebrow,
  title,
  tagline,
  metaLine,
  synopsis,
  actions,
  aside,
  tabs,
  titleColumn = false,
}: Readonly<{
  backdrop: DetailBackdrop
  back?: ReactNode
  endsIn?: number | null
  metadata: MetadataEntry[]
  eyebrow?: string
  title: string
  tagline?: string | null
  metaLine?: string[]
  synopsis?: string | null
  actions: ReactNode
  aside?: ReactNode
  /** Tabs that sit on the panel's top rule, such as Default audio and Subtitles. */
  tabs?: ReactNode
  titleColumn?: boolean
}>) {
  return (
    <header className={styles.header}>
      <BackdropHero
        {...backdrop}
        alt=""
        back={back}
        endsIn={endsIn}
        metadata={<MetadataColumns entries={metadata} />}
      />
      <div className={titleColumn ? `${styles.panel} ${styles.split}` : styles.panel}>
        {tabs && <div className={styles.tabs}>{tabs}</div>}
        <div className={styles.main}>
          <div className={styles.heading}>
            {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
            <h1 className={styles.title}>{title}</h1>
            {tagline && <p className={styles.tagline}>{tagline}</p>}
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
