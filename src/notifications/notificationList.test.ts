import { describe, expect, it } from 'vitest'
import { definedEdges } from '../media/edges'
import {
  answerNotification,
  notificationEdge,
  notificationsPage,
  type NotificationFixture,
} from '../test/notificationFixtures'
import { createLoadedPages, type NotificationEntry } from './notificationList'

/** The entry of a change that places `node` at position `at` of the list. */
function placedAt(node: NotificationFixture, at: number): NotificationEntry {
  const [edge] = definedEdges([notificationEdge(node, at)])
  return { notificationId: node.id, edge }
}

describe('createLoadedPages', () => {
  it('shouldPlaceAChangeAboveTheEndCursorWhenTheLoadedRowAtTheEndCursorMoved', () => {
    const [alex, sam, mara] = ['alex', 'sam', 'mara'].map((id) => answerNotification({ id }))
    const { notifications } = notificationsPage([alex, sam], { hasNextPage: true })
    const loaded = {
      ...notifications,
      edges: [notificationEdge(alex, 1), notificationEdge(sam, 3)],
      pageInfo: { ...notifications.pageInfo, endCursor: 'cursor-003' },
    }
    const pages = createLoadedPages()

    const samMoved = pages.withChange(loaded, placedAt(sam, 0))
    const maraArrived = pages.withChange(samMoved, placedAt(mara, 2))

    expect(maraArrived.edges.map((edge) => edge?.node?.id)).toEqual(['sam', 'alex', 'mara'])
  })
})
