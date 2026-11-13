import { describe, expect, it } from 'vitest'
import { pathOnto, type Box, type Point } from './pointerPath'

// WCAG 2.2 asks that a pointer can move from what it hovers onto the content that its hover shows
// (1.4.13). A menu row 40px tall, whose explanation sits either beside the menu or above it.
const ROW: Box = { left: 100, top: 200, right: 300, bottom: 240 }
const BESIDE_THE_MENU: Box = { left: -150, top: 200, right: 92, bottom: 280 }
const ABOVE_THE_MENU: Box = { left: 90, top: 40, right: 310, bottom: 100 }

// The points a pointer passes as it moves in a straight line from `from` to `to`, both left out.
function pointsBetween(from: Point, to: Point): Point[] {
  return Array.from({ length: 9 }, (_, step) => ({
    x: from.x + ((to.x - from.x) * (step + 1)) / 10,
    y: from.y + ((to.y - from.y) * (step + 1)) / 10,
  }))
}

describe('pathOnto', () => {
  it('shouldHoldEveryPointOnTheStraightLineFromTheRowsSideOntoAnExplanationBesideTheMenu', () => {
    const exit = { x: 100, y: 220 }
    const onThePath = pathOnto({ exit, from: ROW, to: BESIDE_THE_MENU })

    const held = pointsBetween(exit, { x: -29, y: 220 }).filter((point) => onThePath?.(point))

    expect(held).toHaveLength(9)
  })

  it('shouldHoldEveryPointOnTheWayUpFromTheRowsTopOntoAnExplanationAboveTheMenu', () => {
    const exit = { x: 200, y: 200 }
    const onThePath = pathOnto({ exit, from: ROW, to: ABOVE_THE_MENU })

    const held = pointsBetween(exit, { x: 200, y: 70 }).filter((point) => onThePath?.(point))

    expect(held).toHaveLength(9)
  })

  it('shouldLeaveOutAPointBehindTheExitPoint', () => {
    const onThePath = pathOnto({ exit: { x: 100, y: 220 }, from: ROW, to: BESIDE_THE_MENU })

    expect(onThePath?.({ x: 110, y: 220 })).toBe(false)
  })

  it('shouldLeaveOutAPointOnTheRowAboveWhenTheExplanationSitsBesideTheMenu', () => {
    const onThePath = pathOnto({ exit: { x: 200, y: 200 }, from: ROW, to: BESIDE_THE_MENU })

    expect(onThePath?.({ x: 200, y: 180 })).toBe(false)
  })

  // The path keeps a short stretch of the crossed edge, so it starts where the pointer left.
  it.each([
    {
      side: 'top',
      exit: { x: 200, y: 200 },
      explanation: { left: 140, top: 60, right: 260, bottom: 120 },
      beyond: { x: 200, y: 199 },
    },
    {
      side: 'bottom',
      exit: { x: 200, y: 240 },
      explanation: { left: 140, top: 320, right: 260, bottom: 380 },
      beyond: { x: 200, y: 241 },
    },
    {
      side: 'left',
      exit: { x: 100, y: 220 },
      explanation: { left: -100, top: 190, right: 40, bottom: 250 },
      beyond: { x: 99, y: 220 },
    },
    {
      side: 'right',
      exit: { x: 300, y: 220 },
      explanation: { left: 360, top: 190, right: 500, bottom: 250 },
      beyond: { x: 301, y: 220 },
    },
  ])(
    'shouldHoldThePointJustPastTheExitPointWhenTheExplanationLiesBeyondThatSide(side: $side)',
    ({ exit, explanation, beyond }) => {
      const onThePath = pathOnto({ exit, from: ROW, to: explanation })

      expect(onThePath?.(beyond)).toBe(true)
    },
  )

  // jsdom lays nothing out, and a hidden explanation takes no space.
  it('shouldGiveNoPathWhenTheExplanationTakesNoSpace', () => {
    const nowhere = { left: 0, top: 0, right: 0, bottom: 0 }

    expect(pathOnto({ exit: { x: 0, y: 0 }, from: nowhere, to: nowhere })).toBeUndefined()
  })
})
