import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetadataColumns } from './MetadataColumns'

describe('MetadataColumns', () => {
  it('renders each entry as a term and its value, in order', () => {
    render(
      <MetadataColumns
        entries={[
          { label: 'Genre', value: 'Crime, Drama' },
          { label: 'First aired', value: '21 July 2017' },
        ]}
      />,
    )
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual(['Genre', 'First aired'])
    expect(screen.getAllByRole('definition').map((definition) => definition.textContent)).toEqual([
      'Crime, Drama',
      '21 July 2017',
    ])
  })

  it('omits an entry whose value is missing rather than showing an empty column', () => {
    render(
      <MetadataColumns
        entries={[
          { label: 'Created by', value: null },
          { label: 'Rating', value: 'TV-MA' },
        ]}
      />,
    )
    expect(screen.queryByText('Created by')).not.toBeInTheDocument()
    expect(screen.getByText('Rating')).toBeInTheDocument()
  })

  it('renders nothing when no entry has a value', () => {
    const { container } = render(<MetadataColumns entries={[{ label: 'Genre', value: null }]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
