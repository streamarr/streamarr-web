import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { MeQuery } from '../graphql/generated/graphql'
import { canReadNotifications } from '../notifications/notificationAccess'
import { useUnreadNotificationCount } from '../notifications/useUnreadNotificationCount'

type Me = MeQuery['me']

/** The counts after the Profile menu's entries. */
export interface MenuCounts {
  unreadNotifications: number
}

const MenuCountsContext = createContext<MenuCounts>({ unreadNotifications: 0 })

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
  const unreadNotifications = useUnreadNotificationCount({ skip: !canReadNotifications(me) })
  const counts = useMemo(() => ({ unreadNotifications }), [unreadNotifications])
  return <MenuCountsContext value={counts}>{children}</MenuCountsContext>
}

export function useMenuCounts(): MenuCounts {
  return useContext(MenuCountsContext)
}
