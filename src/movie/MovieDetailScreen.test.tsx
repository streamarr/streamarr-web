import { screen, waitFor } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { MovieDetailQuery } from '../graphql/generated/graphql'
import { meFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const ME = meFixture({ scope: 'profile' })

const AMBER_THEME = {
  base: '#d9c5a5',
  panel: '#cdb99a',
  selected: '#f0c069',
  accent: '#6b3a10',
  onAccent: '#f6e7cf',
  textPrimary: '#241505',
  textSecondary: '#5b4326',
}

const TEAL_THEME = { ...AMBER_THEME, accent: '#6fe0bf', base: '#0e3b34' }

// Fragment spreads on Image only match in the cache when the object carries its __typename.
function image(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Image',
    aspectRatio: 1.78,
    blurHash: null,
    ambientColors: null,
    variants: [{ id: 'v1', size: 'LARGE', width: 1920, height: 1080, url: 'backdrop.jpg' }],
    ...overrides,
  }
}

function colored(theme: typeof AMBER_THEME) {
  return {
    topLeft: '#e9b658',
    topRight: '#e9b658',
    bottomRight: '#e9b658',
    bottomLeft: '#e9b658',
    primary: '#e9b658',
    theme,
  }
}

function movieData(overrides: Record<string, unknown> = {}): MovieDetailQuery {
  return {
    movie: {
      __typename: 'Movie',
      id: 'm1',
      title: 'Everlight',
      tagline: 'Change begins with a whisper.',
      summary: 'A quiet town discovers a secret.',
      runtime: 142,
      releaseDate: '2024-05-10',
      contentRating: { value: 'PG-13' },
      genres: [{ id: 'g1', name: 'Drama' }],
      directors: [{ id: 'p1', name: 'Placeholder Director' }],
      cast: [{ id: 'p2', name: 'Lead Actor', images: [] }],
      ratings: [{ id: 'r1', source: 'TMDB', value: '7.8' }],
      files: [{ id: 'file-1' }],
      watchStatus: 'UNWATCHED',
      watchProgress: null,
      backdropImages: [image({ ambientColors: colored(AMBER_THEME) })],
      posterImages: [],
      ...overrides,
    },
  } as MovieDetailQuery
}

function serve(data: MovieDetailQuery, requestedIds: string[] = []) {
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('MovieDetail', ({ variables }) => {
      requestedIds.push(variables.id as string)
      return HttpResponse.json({ data })
    }),
  )
}

describe('MovieDetailScreen', () => {
  it('shows an error state when the query fails', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('MovieDetail', () => HttpResponse.json({ errors: [{ message: 'boom' }] })),
    )
    renderAppAt('/movie/m1')
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })

  it('queries the movie named in the URL and renders its header', async () => {
    const requestedIds: string[] = []
    serve(movieData(), requestedIds)
    renderAppAt('/movie/m1')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Everlight' })).toBeInTheDocument())
    expect(requestedIds).toEqual(['m1'])
    expect(screen.getByText('Change begins with a whisper.')).toBeInTheDocument()
    expect(screen.getByText('2024')).toBeInTheDocument()
    expect(screen.getByText('2h 22m')).toBeInTheDocument()
    expect(screen.getAllByText('PG-13')).not.toHaveLength(0)
    expect(screen.getByText('A quiet town discovers a secret.')).toBeInTheDocument()
    expect(screen.getByText('Directed by')).toBeInTheDocument()
    expect(screen.getByText('Placeholder Director')).toBeInTheDocument()
    expect(screen.getByText('Drama')).toBeInTheDocument()
    expect(screen.getByText('TMDB · 7.8')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('links Play to the file when the movie has not been started', async () => {
    serve(movieData())
    renderAppAt('/movie/m1')
    await waitFor(() => expect(screen.getByRole('link', { name: 'Play' })).toHaveAttribute('href', '/play/file-1'))
  })

  it('links Resume to the saved position when the movie is in progress', async () => {
    serve(movieData({ watchStatus: 'IN_PROGRESS', watchProgress: { positionSeconds: 120, percentComplete: 50 } }))
    renderAppAt('/movie/m1')
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Resume' })).toHaveAttribute('href', '/play/file-1?position=120'),
    )
  })

  it('tints the page from the backdrop theme', async () => {
    serve(movieData())
    renderAppAt('/movie/m1')
    await waitFor(() => expect(screen.getByTestId('ambient-scope').style.getPropertyValue('--ambient-accent')).toBe('#6b3a10'))
  })

  it('falls back to the poster theme when the backdrop has not been colored', async () => {
    serve(movieData({ backdropImages: [image()], posterImages: [image({ ambientColors: colored(TEAL_THEME) })] }))
    renderAppAt('/movie/m1')
    await waitFor(() => expect(screen.getByTestId('ambient-scope').style.getPropertyValue('--ambient-accent')).toBe('#6fe0bf'))
  })

  it('stays neutral when no artwork has been colored', async () => {
    serve(movieData({ backdropImages: [image()] }))
    renderAppAt('/movie/m1')
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Everlight' })).toBeInTheDocument())
    expect(screen.getByTestId('ambient-scope').style.getPropertyValue('--ambient-accent')).toBe('')
  })

  it('marks the movie watched and flips the verb once the server agrees', async () => {
    let watched = false
    const markedIds: string[] = []
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('MovieDetail', () => HttpResponse.json({ data: movieData({ watchStatus: watched ? 'WATCHED' : 'UNWATCHED' }) })),
      graphql.mutation('MarkWatched', ({ variables }) => {
        markedIds.push(variables.id as string)
        watched = true
        return HttpResponse.json({ data: { markWatched: true } })
      }),
    )
    const { user } = renderAppAt('/movie/m1')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark watched' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Mark watched' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark unwatched' })).toBeInTheDocument())
    expect(markedIds).toEqual(['m1'])
  })

  it('omits the cast shelf when there is no cast', async () => {
    serve(movieData({ cast: [] }))
    renderAppAt('/movie/m1')
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Everlight' })).toBeInTheDocument())
    expect(screen.queryByText('Cast')).not.toBeInTheDocument()
  })

  it('lists the cast in a shelf when present', async () => {
    serve(movieData())
    renderAppAt('/movie/m1')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Cast' })).toBeInTheDocument())
    expect(screen.getByText('Lead Actor')).toBeInTheDocument()
  })
})
