// `MediaConnection.edges` and `MediaEdge.node` are both nullable in the schema (Relay style, no
// `!`) — every connection this app queries only ever wants the edges that actually resolved.
export function definedEdges<TCursor extends string, TNode>(
  edges: ReadonlyArray<{ cursor: TCursor; node: TNode | null } | null> | null | undefined,
): { cursor: TCursor; node: TNode }[] {
  return (edges ?? []).flatMap((edge) => (edge?.node ? [{ cursor: edge.cursor, node: edge.node }] : []))
}
