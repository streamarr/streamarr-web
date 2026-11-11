import { screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { NotificationsQuery } from '../graphql/generated/graphql'
import { failsOnceThen } from '../test/graphqlResponses'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { meFixture } from '../test/meFixture'
import {
  answerNotification,
  hoursAgo,
  notificationsPage,
  offerNotification,
} from '../test/notificationFixtures'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'
import homeShellStyles from '../ui/HomeShell.module.css'

const NOTIFICATIONS = '/notifications'

function serve(page: NotificationsQuery = notificationsPage([]), me = meFixture()) {
  const socket = serveGraphqlSocket()
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('Notifications', () => HttpResponse.json({ data: page })),
  )
  return socket
}

function rows() {
  return within(screen.getByRole('list', { name: 'Notifications' })).getAllByRole('listitem')
}

describe('Notifications', () => {
  it('shouldOpenNotificationsFromTheProfileMenu', async () => {
    serve(notificationsPage([offerNotification()]))
    server.use(
      graphql.query('Home', () =>
        HttpResponse.json({ data: { continueWatching: { edges: [] }, libraries: [] } }),
      ),
    )
    const { user, router } = renderAppAt('/')

    await user.click(await screen.findByRole('button', { name: /^Profile menu/ }))
    await user.click(screen.getByRole('button', { name: 'Notifications' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
    expect(router.state.location.pathname).toBe(NOTIFICATIONS)
  })

  it('shouldStandOnTheNeutralGroundWhenNotificationsOpen', async () => {
    serve()
    renderAppAt(NOTIFICATIONS)

    await screen.findByRole('heading', { level: 1, name: 'Notifications' })

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(document.querySelector(`.${homeShellStyles.homeAmbient}`)).toBeNull()
  })

  it('shouldListEachNotificationInTheServersOrderAndWordsWhenTheyLoad', async () => {
    serve(
      notificationsPage([
        offerNotification(),
        answerNotification({ message: '“<b>Cabin</b>” accepted the Profile “Leo”.' }),
      ]),
    )
    renderAppAt(NOTIFICATIONS)

    await screen.findByText('“Sam” offered the Profile “Alex” to your Household.')

    expect(rows().map((row) => row.querySelector('p')?.textContent)).toEqual([
      '“Sam” offered the Profile “Alex” to your Household.',
      '“<b>Cabin</b>” accepted the Profile “Leo”.',
    ])
    expect(document.querySelector('b')).toBeNull()
  })

  it('shouldSayWhenEachNotificationHappenedWhenTheyLoad', async () => {
    const longAgo = new Date(2026, 9, 3, 14, 5)
    serve(
      notificationsPage([
        offerNotification({ latestEventAt: hoursAgo(3) }),
        answerNotification({ latestEventAt: longAgo.toISOString() }),
      ]),
    )
    renderAppAt(NOTIFICATIONS)

    await screen.findByText('3 hours ago')

    const [recent, older] = rows()
    expect(within(recent).getByText('3 hours ago')).toBeVisible()
    expect(within(older).getByText('Oct 3, 2026')).toBeVisible()
    expect(older).toHaveTextContent(/Saturday, October 3, 2026 at 2:05/)
    expect(older.querySelector('time')).toHaveAttribute('dateTime', longAgo.toISOString())
  })

  it('shouldSayThereAreNoNotificationsWhenTheListIsEmpty', async () => {
    serve()
    renderAppAt(NOTIFICATIONS)

    expect(await screen.findByText('No notifications.')).toBeVisible()
    expect(screen.queryByRole('list', { name: 'Notifications' })).not.toBeInTheDocument()
  })

  it('shouldOfferRetryWhenTheListCannotLoad', async () => {
    serve()
    const list = failsOnceThen(notificationsPage([offerNotification()]))
    server.use(graphql.query('Notifications', list.resolver))
    const { user } = renderAppAt(NOTIFICATIONS)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load notifications.")
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(
      await screen.findByText('“Sam” offered the Profile “Alex” to your Household.'),
    ).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})
