import { useQuery } from '@apollo/client/react'
import { Alert, Center, Loader, Text } from '@mantine/core'
import { HomeDocument, type HomeQuery } from '../graphql/generated/graphql'
import { definedEdges } from '../media/edges'
import { billboardFromContinueWatching, billboardFromRecentlyAdded, type BillboardContent } from './billboardContent'
import { BillboardHero } from './BillboardHero'
import { ContinueWatchingShelf } from './ContinueWatchingShelf'
import styles from './Home.module.css'
import { RecentlyAddedRail } from './RecentlyAddedRail'

export function Home() {
  const { data, loading, error } = useQuery(HomeDocument)

  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  if (error || !data) {
    return (
      <Alert color="red" role="alert">
        Couldn't load your library. Try again.
      </Alert>
    )
  }

  const billboard = billboardContentFor(data)
  if (!billboard) {
    return (
      <Center h={200}>
        <Text c="dimmed">Nothing to watch yet.</Text>
      </Center>
    )
  }

  const movieLibrary = data.libraries.find((library) => library.type === 'MOVIE')
  const seriesLibrary = data.libraries.find((library) => library.type === 'SERIES')

  return (
    <div className={styles.home}>
      <BillboardHero content={billboard} />
      <ContinueWatchingShelf items={data.continueWatching} />
      {(movieLibrary || seriesLibrary) && (
        <div className={styles.recentlyAdded}>
          {movieLibrary && <RecentlyAddedRail library={movieLibrary} />}
          {seriesLibrary && <RecentlyAddedRail library={seriesLibrary} />}
        </div>
      )}
    </div>
  )
}

// The billboard fallback reuses data Home already fetched (no second query): when nobody has
// started anything, the newer of the two Recently Added rails' head items stands in.
function billboardContentFor(data: HomeQuery): BillboardContent | null {
  if (data.continueWatching.length > 0) {
    return billboardFromContinueWatching(data.continueWatching[0])
  }

  const movieCandidate = firstRecentNode(data, 'MOVIE')
  const seriesCandidate = firstRecentNode(data, 'SERIES')
  const candidates = [movieCandidate, seriesCandidate].filter(
    (candidate): candidate is NonNullable<typeof candidate> => candidate !== null,
  )
  if (candidates.length === 0) {
    return null
  }
  const newest = candidates.reduce((a, b) => (a.createdOn > b.createdOn ? a : b))
  return billboardFromRecentlyAdded(newest)
}

function firstRecentNode(data: HomeQuery, type: 'MOVIE' | 'SERIES') {
  const library = data.libraries.find((candidate) => candidate.type === type)
  return definedEdges(library?.items.edges)[0]?.node ?? null
}
