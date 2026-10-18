import { describe, expect, it } from 'vitest'
import { definedEdges } from './edges'

describe('definedEdges', () => {
  it('shouldPreservePaginationFieldsWhileRemovingUnresolvedNodes', () => {
    const edge = { cursor: 'server-cursor', orderKey: 'server-order', node: { id: 'movie' } }
    expect(definedEdges([null, { ...edge, node: null }, edge])).toEqual([edge])
  })

  it('retains resolved falsy nodes', () => {
    const edges = [
      { cursor: 'zero', node: 0 },
      { cursor: 'false', node: false },
      { cursor: 'empty', node: '' },
    ]
    expect(definedEdges(edges)).toEqual(edges)
  })

  it('keeps edges whose node resolved', () => {
    expect(definedEdges([{ cursor: 'a', node: { id: 1 } }])).toEqual([
      { cursor: 'a', node: { id: 1 } },
    ])
  })

  it('drops edges with a null node', () => {
    expect(definedEdges([{ cursor: 'a', node: null }])).toEqual([])
  })

  it('drops null entries in the edges list', () => {
    expect(definedEdges([null, { cursor: 'a', node: { id: 1 } }])).toEqual([
      { cursor: 'a', node: { id: 1 } },
    ])
  })

  it('returns an empty array for a null or undefined edges list', () => {
    expect(definedEdges(null)).toEqual([])
    expect(definedEdges(undefined)).toEqual([])
  })
})
