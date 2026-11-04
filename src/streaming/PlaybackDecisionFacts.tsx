import type { ReactNode } from 'react'
import type { PlaybackDecisionFieldsFragment } from '../graphql/generated/graphql'
import styles from './PlaybackDecisionFacts.module.css'
import { audioFormatText, deliveryText, reasonText, videoFormatText } from './playbackDecisionText'

/** How one format attempt delivers each track, from what source to what output, and why. */
export function PlaybackDecisionFacts({
  decision,
}: Readonly<{ decision: PlaybackDecisionFieldsFragment }>) {
  const { video, audio, reasons } = decision
  return (
    <>
      <Facts>
        <Fact name="Video" value={deliveryText(video.delivery)} />
        <Fact name="Video source" value={videoFormatText(video.source)} />
        <Fact name="Video output" value={videoFormatText(video.output)} />
        <Fact name="Audio" value={audio ? deliveryText(audio.delivery) : 'No audio'} />
        {audio && (
          <>
            <Fact name="Audio source" value={audioFormatText(audio.source)} />
            <Fact name="Audio output" value={audioFormatText(audio.output)} />
          </>
        )}
      </Facts>
      {reasons.length === 0 ? (
        <p className={styles.note}>Every track plays as the file holds it.</p>
      ) : (
        <ul className={styles.reasons} aria-label="Reasons">
          {reasons.map((reason, index) => (
            <li key={`${index}-${reason}`}>{reasonText(reason)}</li>
          ))}
        </ul>
      )}
    </>
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
