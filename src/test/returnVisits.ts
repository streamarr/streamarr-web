import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { expect } from 'vitest'
import { watchingConnection } from './continueWatchingFixtures'
import { server } from './server'

/** A page of a settings area, as a person finds it. */
export interface SettingsPage {
  /** The area's entry in the Profile menu. */
  area: string
  /** The page's heading. */
  heading: string
}

/** Leaves a settings page for Home, which has nothing to show. */
export async function leaveForHome(user: UserEvent, { heading }: SettingsPage) {
  server.use(
    graphql.query('Home', () =>
      HttpResponse.json({ data: { continueWatching: watchingConnection([]), libraries: [] } }),
    ),
  )
  await user.click(
    within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Home' }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument(),
  )
}

/** Opens a settings page again from the Profile menu. */
export async function returnThroughTheProfileMenu(
  user: UserEvent,
  { area, heading }: SettingsPage,
) {
  await user.click(screen.getByRole('button', { name: /^Profile menu/ }))
  await user.click(await screen.findByRole('button', { name: area }))
  await screen.findByRole('heading', { level: 1, name: heading })
}

export async function leaveForHomeAndReturn(user: UserEvent, page: SettingsPage) {
  await leaveForHome(user, page)
  await returnThroughTheProfileMenu(user, page)
}
