import { useRef, type ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import styles from './ContentShelf.module.css'

export function ContentShelf({
  title,
  children,
}: Readonly<{
  title: string
  children: ReactNode
}>) {
  const trackRef = useRef<HTMLDivElement>(null)

  function scroll(direction: -1 | 1) {
    const track = trackRef.current
    track?.scrollBy({ left: direction * track.clientWidth, behavior: 'smooth' })
  }

  return (
    <section className={styles.shelf}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.arrows}>
          <button
            type="button"
            className={styles.arrow}
            aria-label="Scroll left"
            onClick={() => scroll(-1)}
          >
            <Icon name="chevron-left" size={16} />
          </button>
          <button
            type="button"
            className={styles.arrow}
            aria-label="Scroll right"
            onClick={() => scroll(1)}
          >
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
      </div>
      <div className={styles.track} ref={trackRef}>
        {children}
      </div>
    </section>
  )
}
