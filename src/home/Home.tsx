import { useQuery } from '@apollo/client/react'
import { Center, Loader, Text } from '@mantine/core'
import { HomeDocument, type HomeQuery } from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { definedEdges } from '../media/edges'
import {
  billboardFromContinueWatching,
  billboardFromRecentlyAdded,
  type BillboardContent,
} from './billboardContent'
import { BillboardHero } from './BillboardHero'
import { ContinueWatchingShelf } from './ContinueWatchingShelf'
import styles from './Home.module.css'
import { RecentlyAddedRail } from './RecentlyAddedRail'
import { useMe } from '../identity/useMe'
import { canManageServer } from '../admin/access'
import { EmptyLibraries } from '../admin/libraries/EmptyLibraries'
import { FailurePanel } from '../ui/Failure'

export function Home() {
  const { data, loading, error, refetch } = useQuery(HomeDocument)
  const { data: identity } = useMe()

  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  if (error || !data) {
    return (
      <FailurePanel onRetry={refetch}>
        {requestFailureMessage(error, "Couldn't load your library.")}
      </FailurePanel>
    )
  }

  const billboard = billboardContentFor(data)
  if (!billboard) {
    if (data.libraries.length === 0)
      return <EmptyLibraries canCreate={canManageServer(identity?.me)} />
    return (
      <Center h={200}>
        <Text c="dimmed">Nothing to watch yet.</Text>
      </Center>
    )
  }

  const libraries = data.libraries.filter(
    (library) => library.type === 'MOVIE' || library.type === 'SERIES',
  )

  return (
    <div className={styles.home}>
      <BillboardHero content={billboard} />
      <ContinueWatchingShelf items={data.continueWatching} />
      {libraries.length > 0 && (
        <div className={styles.recentlyAdded}>
          {libraries.map((library) => (
            <RecentlyAddedRail key={library.id} library={library} />
          ))}
        </div>
      )}
    </div>
  )
}

// The billboard fallback reuses data Home already fetched (no second query): when nobody has
// started anything, the newest of the Recently Added rails' head items stands in.
function billboardContentFor(data: HomeQuery): BillboardContent | null {
  if (data.continueWatching.length > 0) {
    return billboardFromContinueWatching(data.continueWatching[0])
  }

  const candidates = data.libraries
    .filter((library) => library.type === 'MOVIE' || library.type === 'SERIES')
    .flatMap((library) =>
      definedEdges(library.items.edges)
        .slice(0, 1)
        .map((edge) => edge.node),
    )
  if (candidates.length === 0) {
    return null
  }
  const newest = candidates.reduce((a, b) => (a.createdOn > b.createdOn ? a : b), candidates[0])
  return billboardFromRecentlyAdded(newest)
}
