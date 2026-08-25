import { screen } from '@testing-library/react'
import { HttpResponse, graphql } from 'msw'
import { describe, expect, it } from 'vitest'
import { meFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const ME = meFixture({ scope: 'profile' })

describe('the root layout', () => {
  it('shouldRenderACeremonyWithoutTheSignedInChrome', async () => {
    renderAppAt('/login')

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(document.querySelector('.homeShell')).toBeNull()
  })

  it('shouldWrapASignedInPageInTheChrome', async () => {
    server.use(graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })))
    renderAppAt('/')

    expect(await screen.findByText(/welcome, owner/i)).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(document.querySelector('.homeShell')).not.toBeNull()
  })
})
