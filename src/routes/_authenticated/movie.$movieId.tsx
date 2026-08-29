import { createFileRoute } from '@tanstack/react-router'
import { MovieDetailScreen } from '../../movie/MovieDetailScreen'

export const Route = createFileRoute('/_authenticated/movie/$movieId')({
  component: MovieRoute,
})

function MovieRoute() {
  const { movieId } = Route.useParams()
  return <MovieDetailScreen movieId={movieId} />
}
