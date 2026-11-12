import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { MeQuery } from '../graphql/generated/graphql'
import { canManageHousehold } from '../identity/householdAccess'
import { useWaitingOffers } from '../identity/useWaitingOffers'
import { canReadNotifications } from '../notifications/notificationAccess'
import { useUnreadNotificationCount } from '../notifications/useUnreadNotificationCount'

type Me = MeQuery['me']

/** The counts after the Profile menu's entries. */
export interface MenuCounts {
  unreadNotifications: number
  /** The offers of Profiles to the Account's Household that wait for its admins' decision. */
  waitingOffers: number
  /**
   * Called as a Notification's mark goes out: the function it returns takes the unread count that
   * the mark answers, unless a change has brought one since (`useUnreadNotificationCount`).
   */
  markSent: () => (count: number) => void
}

const MenuCountsContext = createContext<MenuCounts>({
  unreadNotifications: 0,
  waitingOffers: 0,
  markSent: () => () => undefined,
})

/**
 * Reads the counts after the Profile menu's entries for `me` and keeps them current while it is
 * given. It sits above the pages because the top bar mounts again whenever a page changes ground,
 * and each mount would read the counts again and follow their changes anew, which reads every
 * page's queries again. `me` is absent while signed out and on the Profile picker, where there is
 * no Profile menu, so nothing is read there.
 */
export function MenuCountsProvider({
  me,
  children,
}: Readonly<{ me: Me | undefined; children: ReactNode }>) {
  const unread = useUnreadNotificationCount({ skip: !canReadNotifications(me) })
  const waitingOffers = useWaitingOfferCount(me)
  const counts = useMemo(
    () => ({
      unreadNotifications: unread.count,
      waitingOffers,
      markSent: unread.markSent,
    }),
    [unread.count, unread.markSent, waitingOffers],
  )
  return <MenuCountsContext value={counts}>{children}</MenuCountsContext>
}

/**
 * How many offers wait for the decision of the Household's admins, taken from the offers
 * themselves as Share offers lists them, so that an admin promoted since they arrived sees them
 * too. Zero for anyone else, who reads nothing.
 */
function useWaitingOfferCount(me: Me | undefined): number {
  const { offers } = useWaitingOffers(
    { householdId: me?.household.id ?? '', serverAdmin: me?.serverAdmin ?? false },
    { skip: !canManageHousehold(me) },
  )
  return offers.length
}

export function useMenuCounts(): MenuCounts {
  return useContext(MenuCountsContext)
}
