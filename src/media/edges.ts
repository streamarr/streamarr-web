// `MediaConnection.edges` and `MediaEdge.node` are nullable in the server contract.
export function definedEdges<TEdge extends { cursor: string; node: unknown }>(
  edges: ReadonlyArray<TEdge | null> | null | undefined,
): (TEdge & { node: NonNullable<TEdge['node']> })[] {
  return (edges ?? []).filter(
    (edge): edge is TEdge & { node: NonNullable<TEdge['node']> } => edge?.node != null,
  )
}

/** The pagination fields every server-ordered list's edges share. */
type OrderedEdge = { cursor: string; orderKey: string }

/**
 * Replaces an item's edge in a list kept in order-key order; a null edge only removes the item.
 * Keys compare as ascending ASCII strings, whatever the sort direction.
 */
export function placeOrderedEdge<TEdge extends OrderedEdge & { node: { id: string } }>(
  edges: readonly TEdge[],
  { itemId, edge }: { itemId: string; edge: TEdge | null },
): TEdge[] {
  const others = edges.filter((other) => other.node.id !== itemId)
  if (edge === null) return others
  const index = others.findIndex((other) => other.orderKey > edge.orderKey)
  return others.toSpliced(index < 0 ? others.length : index, 0, edge)
}
