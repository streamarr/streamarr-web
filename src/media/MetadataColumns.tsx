import styles from './MetadataColumns.module.css'

export interface MetadataEntry {
  label: string
  value: string | null
}

// An entry with nothing to say is absent, not dimmed (principle 7.1).
export function MetadataColumns({ entries }: { entries: MetadataEntry[] }) {
  const present = entries.filter((entry): entry is { label: string; value: string } => Boolean(entry.value))
  if (present.length === 0) {
    return null
  }

  return (
    <dl className={styles.columns}>
      {present.map((entry) => (
        <div key={entry.label} className={styles.column}>
          <dt className={styles.label}>{entry.label}</dt>
          <dd className={styles.value}>{entry.value}</dd>
        </div>
      ))}
    </dl>
  )
}
