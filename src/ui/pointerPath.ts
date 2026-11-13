/** A point on the page, in CSS pixels from the viewport's top-left corner. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** A box on the page, as `getBoundingClientRect` measures it. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** Whether a point lies on the path that a pointer takes onto a box. */
export type PointerPath = (point: Point) => boolean

type Side = 'top' | 'bottom' | 'left' | 'right'

// The path keeps this much of the crossed edge on each side of the exit point, reaching this far
// back into the box the pointer left, so a pointer that leaves near a corner starts on the path.
const EXIT_REACH_PX = 5

const EXIT_EDGES: Record<Side, (exit: Point) => Point[]> = {
  top: ({ x, y }) => [
    { x: x - EXIT_REACH_PX, y: y + EXIT_REACH_PX },
    { x: x + EXIT_REACH_PX, y: y + EXIT_REACH_PX },
  ],
  bottom: ({ x, y }) => [
    { x: x - EXIT_REACH_PX, y: y - EXIT_REACH_PX },
    { x: x + EXIT_REACH_PX, y: y - EXIT_REACH_PX },
  ],
  left: ({ x, y }) => [
    { x: x + EXIT_REACH_PX, y: y - EXIT_REACH_PX },
    { x: x + EXIT_REACH_PX, y: y + EXIT_REACH_PX },
  ],
  right: ({ x, y }) => [
    { x: x - EXIT_REACH_PX, y: y - EXIT_REACH_PX },
    { x: x - EXIT_REACH_PX, y: y + EXIT_REACH_PX },
  ],
}

/**
 * The path that a pointer takes after it leaves the box `from` at `exit`, toward the box `to`: the
 * smallest convex area that holds `to` and a short stretch of the edge that the pointer crossed.
 * Undefined when `to` takes no space, because the pointer then has nothing to move onto.
 */
export function pathOnto({
  exit,
  from,
  to,
}: {
  exit: Point
  from: Box
  to: Box
}): PointerPath | undefined {
  if (to.right <= to.left || to.bottom <= to.top) {
    return undefined
  }
  const corners = [
    ...EXIT_EDGES[sideNearest(exit, from)](exit),
    { x: to.left, y: to.top },
    { x: to.right, y: to.top },
    { x: to.right, y: to.bottom },
    { x: to.left, y: to.bottom },
  ]
  // A point lies in the smallest convex area that holds a set of points exactly when it lies in a
  // triangle of three of them.
  const triangles = trianglesOf(corners)
  return (point) => triangles.some((triangle) => isInTriangle(point, triangle))
}

function sideNearest({ x, y }: Point, box: Box): Side {
  const distances: [Side, number][] = [
    ['top', Math.abs(y - box.top)],
    ['bottom', Math.abs(box.bottom - y)],
    ['left', Math.abs(x - box.left)],
    ['right', Math.abs(box.right - x)],
  ]
  return distances.reduce((nearest, side) => (side[1] < nearest[1] ? side : nearest))[0]
}

type Triangle = readonly [Point, Point, Point]

// A triangle of three points on one line holds no area, and its sign test would hold the whole line.
function trianglesOf(points: readonly Point[]): Triangle[] {
  return points.flatMap((a, first) =>
    points.slice(first + 1).flatMap((b, second) =>
      points
        .slice(first + second + 2)
        .filter((c) => turn(a, b, c) !== 0)
        .map((c): Triangle => [a, b, c]),
    ),
  )
}

// The point lies on one side of every edge, or on an edge.
function isInTriangle(point: Point, [a, b, c]: Triangle): boolean {
  const turns = [turn(a, b, point), turn(b, c, point), turn(c, a, point)]
  return turns.every((value) => value >= 0) || turns.every((value) => value <= 0)
}

// Positive when `to` lies left of the line from `from` through `via`, negative when right, zero on it.
function turn(from: Point, via: Point, to: Point): number {
  return (via.x - from.x) * (to.y - from.y) - (via.y - from.y) * (to.x - from.x)
}
