import { useRef, type ReactNode } from 'react'
import styles from './ContentShelf.module.css'

const SCROLL_AMOUNT = 480

export function ContentShelf({ title, count, children }: { title: string; count?: string; children: ReactNode }) {
  const trackRef = useRef<HTMLDivElement>(null)

  function scroll(direction: -1 | 1) {
    trackRef.current?.scrollBy({ left: direction * SCROLL_AMOUNT, behavior: 'smooth' })
  }

  return (
    <section className={styles.shelf}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title}>{title}</h2>
          {count && <span className={styles.count}>{count}</span>}
        </div>
        <div className={styles.arrows}>
          <button type="button" className={styles.arrow} aria-label="Scroll left" onClick={() => scroll(-1)}>
            <ChevronGlyph direction="left" />
          </button>
          <button type="button" className={styles.arrow} aria-label="Scroll right" onClick={() => scroll(1)}>
            <ChevronGlyph direction="right" />
          </button>
        </div>
      </div>
      <div className={styles.track} ref={trackRef}>
        {children}
      </div>
    </section>
  )
}

function ChevronGlyph({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d={direction === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
