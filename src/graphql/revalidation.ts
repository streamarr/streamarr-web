interface EventSource {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

interface RevalidationDependencies {
  refetchActive: () => Promise<unknown>
  /** Whether any active query has a read in flight. */
  isReading: () => boolean
  onSubscribed: (listener: () => void) => () => void
  window: EventSource
  document: EventSource & { readonly visibilityState: DocumentVisibilityState }
}

/**
 * Refetches the active queries after a gap in which live changes may have been missed: a socket
 * subscribed after the queries read, the network came back, or the page returned from the
 * background. Overlapping triggers share one refetch, except that a socket subscribing during any
 * read earns one more after it. Nothing runs on a timer. Returns the uninstaller.
 */
export function installRevalidation({
  refetchActive,
  isReading,
  onSubscribed,
  window,
  document,
}: RevalidationDependencies): () => void {
  let inFlight: Promise<void> | null = null
  let readAgainAfterInFlight = false
  let hidden = document.visibilityState === 'hidden'

  // Silent: a failed refetch surfaces through the queries that ran it.
  const revalidate = (): void => {
    inFlight ??= refetchActive()
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        inFlight = null
        if (!readAgainAfterInFlight) return
        readAgainAfterInFlight = false
        revalidate()
      })
  }

  // A read that began before the socket subscribed can miss a change committed in between, and no
  // frame reports that change. A refetch now would share that read, so one more follows it.
  const onSocketSubscribed = (): void => {
    if (inFlight || isReading()) readAgainAfterInFlight = true
    revalidate()
  }

  const onVisibilityChange = (): void => {
    const returning = hidden && document.visibilityState === 'visible'
    hidden = document.visibilityState === 'hidden'
    if (returning) revalidate()
  }

  const stopSubscribed = onSubscribed(onSocketSubscribed)
  window.addEventListener('online', revalidate)
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    stopSubscribed()
    window.removeEventListener('online', revalidate)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
