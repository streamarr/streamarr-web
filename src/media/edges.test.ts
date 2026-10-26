import { describe, expect, it } from 'vitest'
import { definedEdges, placeOrderedEdge } from './edges'

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

describe('placeOrderedEdge', () => {
  const edge = (id: string, orderKey: string) => ({
    cursor: `cursor-${id}`,
    orderKey,
    node: { id },
  })

  it('shouldInsertBeforeTheFirstGreaterOrderKeyWhenTheItemIsNew', () => {
    const edges = [edge('a', '10'), edge('c', '30')]
    expect(placeOrderedEdge(edges, { itemId: 'b', edge: edge('b', '20') })).toEqual([
      edge('a', '10'),
      edge('b', '20'),
      edge('c', '30'),
    ])
  })

  it('shouldAppendWhenNoLoadedOrderKeyIsGreater', () => {
    expect(placeOrderedEdge([edge('a', '10')], { itemId: 'b', edge: edge('b', '20') })).toEqual([
      edge('a', '10'),
      edge('b', '20'),
    ])
  })

  it('shouldMoveTheItemWithoutDuplicatingItWhenItIsAlreadyLoaded', () => {
    const edges = [edge('a', '10'), edge('b', '20'), edge('c', '30')]
    expect(placeOrderedEdge(edges, { itemId: 'a', edge: edge('a', '40') })).toEqual([
      edge('b', '20'),
      edge('c', '30'),
      edge('a', '40'),
    ])
  })

  it('shouldRemoveTheItemWhenTheEdgeIsNull', () => {
    const edges = [edge('a', '10'), edge('b', '20')]
    expect(placeOrderedEdge(edges, { itemId: 'a', edge: null })).toEqual([edge('b', '20')])
  })

  it('shouldCompareOrderKeysAsAsciiStringsWhenLocaleOrderDiffers', () => {
    const edges = [edge('upper', 'B')]
    expect(placeOrderedEdge(edges, { itemId: 'lower', edge: edge('lower', 'a') })).toEqual([
      edge('upper', 'B'),
      edge('lower', 'a'),
    ])
  })
})
