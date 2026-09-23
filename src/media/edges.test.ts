import { describe, expect, it } from 'vitest'
import { definedEdges } from './edges'

describe('definedEdges', () => {
  it('retains resolved falsy nodes', () => {
    const edges = [
      { cursor: 'zero', node: 0 },
      { cursor: 'false', node: false },
      { cursor: 'empty', node: '' },
    ]
    expect(definedEdges<string, number | boolean | string>(edges)).toEqual(edges)
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
