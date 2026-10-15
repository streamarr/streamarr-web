interface EventSource {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

interface RevalidationDependencies {
  refetchActive: () => Promise<unknown>
  onRecovered: (listener: () => void) => () => void
  window: EventSource
  document: EventSource & { readonly visibilityState: DocumentVisibilityState }
}

/**
 * Refetches the active queries after a gap in which live changes may have been missed: the
 * subscription socket recovered, the network came back, or the page returned from the
 * background. Overlapping triggers share one refetch, and nothing runs on a timer. Returns the
 * uninstaller.
 */
export function installRevalidation({
  refetchActive,
  onRecovered,
  window,
  document,
}: RevalidationDependencies): () => void {
  let inFlight: Promise<void> | null = null
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
      })
  }

  const onVisibilityChange = (): void => {
    const returning = hidden && document.visibilityState === 'visible'
    hidden = document.visibilityState === 'hidden'
    if (returning) revalidate()
  }

  const stopRecovered = onRecovered(revalidate)
  window.addEventListener('online', revalidate)
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    stopRecovered()
    window.removeEventListener('online', revalidate)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
