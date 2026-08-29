import { Link } from '@tanstack/react-router'
import type { HomeQuery } from '../graphql/generated/graphql'
import { definedEdges } from '../media/edges'
import { PosterCard } from '../media/PosterCard'
import { StickySectionContainer } from '../media/StickySectionContainer'
import { summarizeMedia } from '../media/summarizeMedia'
import { badgeFromWatchState } from '../media/WatchedBadge'
import styles from './RecentlyAddedRail.module.css'

type LibraryWithItems = HomeQuery['libraries'][number]

export function RecentlyAddedRail({ library }: { library: LibraryWithItems }) {
  const edges = definedEdges(library.items.edges)

  return (
    <StickySectionContainer
      title={`Recently added in ${library.name ?? 'Library'}`}
      action={
        <Link
          to="/library/$libraryId"
          params={{ libraryId: library.id }}
          search={{ by: 'ADDED', direction: 'DESC' }}
          className={styles.seeAll}
        >
          See all
        </Link>
      }
    >
      <div className={styles.grid}>
        {edges.map((edge) => {
          const summary = summarizeMedia(edge.node)
          const card = (
            <PosterCard
              title={summary.title}
              meta={summary.meta}
              image={summary.poster}
              blurHash={summary.blurHash}
              badge={badgeFromWatchState(summary.watchStatus, summary.percentComplete)}
            />
          )
          return edge.node.__typename === 'Movie' ? (
            <Link key={edge.cursor} to="/movie/$movieId" params={{ movieId: summary.id }} className={styles.cardLink}>
              {card}
            </Link>
          ) : (
            <div key={edge.cursor}>{card}</div>
          )
        })}
      </div>
    </StickySectionContainer>
  )
}
