import styles from './RatingChipRow.module.css'

interface Rating {
  id: string
  source: string
  value: string
}

// Ratings are free-form source/value pairs; each chip carries its own source rather than
// assuming which is a critic and which an audience score.
export function RatingChipRow({ ratings }: { ratings: ReadonlyArray<Rating | null> }) {
  const present = ratings.filter((rating): rating is Rating => rating !== null)
  if (present.length === 0) {
    return null
  }

  return (
    <ul className={styles.row}>
      {present.map((rating) => (
        <li key={rating.id} className={styles.chip}>
          {rating.source} · {rating.value}
        </li>
      ))}
    </ul>
  )
}
