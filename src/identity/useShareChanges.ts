import { ProfileShareChangedDocument } from '../graphql/generated/graphql'
import { responsePathHasError } from '../graphql/responseErrors'
import { useLiveChanges } from '../graphql/useLiveChanges'
import type { ShareChange } from './shareLists'

/**
 * Hands each committed change to a Profile share that the session may read to `onChange` while
 * the calling component is mounted. A page calls it before it queries its list of shares, so the
 * list misses no change that committed between its read and the subscription (`useLiveChanges`).
 *
 * A change whose share arrives with errors is no change to apply, not even a removal: the
 * transport reports it missed, and the active queries read again.
 */
export function useShareChanges(
  onChange: (change: ShareChange) => void,
  options?: { skip?: boolean },
) {
  useLiveChanges(
    ProfileShareChangedDocument,
    ({ data, error }) => {
      const change = data?.profileShareChanged
      if (!change) return
      if (responsePathHasError(error, ['profileShareChanged', 'share'])) return
      onChange(change)
    },
    options,
  )
}
