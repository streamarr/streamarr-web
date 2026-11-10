import { VisuallyHidden } from '@mantine/core'
import { type ReactNode, useId } from 'react'
import type { PlaybackDecisionFieldsFragment, PlaybackDelivery } from '../graphql/generated/graphql'
import styles from './PlaybackDecisionFacts.module.css'
import {
  audioRows,
  deliveryText,
  type PlacedReasons,
  type TrackRow,
  videoRows,
} from './playbackDecisionText'

/**
 * How one format attempt delivers each track: its source and output side by side, each row the
 * output changes marked, and the reasons for the change under the track. A source without audio
 * has no Audio track.
 */
export function PlaybackDecisionTracks({
  decision,
  reasons,
}: Readonly<{ decision: PlaybackDecisionFieldsFragment; reasons: PlacedReasons }>) {
  const { video, audio } = decision
  return (
    <>
      <Track name="Video" delivery={video.delivery} reasons={reasons.video}>
        <TrackTable rows={videoRows(video)} />
      </Track>
      {audio && (
        <Track name="Audio" delivery={audio.delivery} reasons={reasons.audio}>
          <TrackTable rows={audioRows(audio)} />
        </Track>
      )}
    </>
  )
}

function Track({
  name,
  delivery,
  reasons,
  children,
}: Readonly<{
  name: string
  delivery: PlaybackDelivery
  reasons: string[]
  children: ReactNode
}>) {
  const nameId = useId()
  return (
    <section className={styles.track} aria-labelledby={nameId}>
      <h4 className={styles.trackHeading}>
        <span id={nameId}>{name}</span>{' '}
        <span className={styles.delivery}>{deliveryText(delivery)}</span>
      </h4>
      {children}
      {reasons.length > 0 && (
        <ul className={styles.reasons} aria-label={`${name} reasons`}>
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TrackTable({ rows }: Readonly<{ rows: TrackRow[] }>) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">
            <VisuallyHidden>Property</VisuallyHidden>
          </th>
          <th scope="col">Original</th>
          <th scope="col">Playing</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ name, original, playing, changed }) => (
          <tr key={name} className={changed ? styles.changed : undefined}>
            <th scope="row">
              {name}
              {changed && <VisuallyHidden> (changed)</VisuallyHidden>}
            </th>
            <td>{original}</td>
            <td>{playing}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** A list of named figures. */
export function Facts({ children }: Readonly<{ children: ReactNode }>) {
  return <dl className={styles.facts}>{children}</dl>
}

/** One named figure of a facts list. */
export function Fact({ name, value }: Readonly<{ name: string; value: string }>) {
  return (
    <div className={styles.fact}>
      <dt className={styles.name}>{name}</dt>
      <dd className={styles.value}>{value}</dd>
    </div>
  )
}
