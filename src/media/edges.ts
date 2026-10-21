// `MediaConnection.edges` and `MediaEdge.node` are nullable in the server contract.
export function definedEdges<TEdge extends { cursor: string; node: unknown }>(
  edges: ReadonlyArray<TEdge | null> | null | undefined,
): (TEdge & { node: NonNullable<TEdge['node']> })[] {
  return (edges ?? []).filter(
    (edge): edge is TEdge & { node: NonNullable<TEdge['node']> } => edge?.node != null,
  )
}
