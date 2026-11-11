import type { Locator } from '@playwright/test'

/** WCAG 2 contrast ratio between two sRGB colors with channels from 0 to 255. */
export function contrast(one: number[], other: number[]): number {
  const luminance = (color: number[]) => {
    const [red, green, blue] = color.map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const [lighter, darker] = [luminance(one), luminance(other)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

/** An element's text color and what lies behind the text, as the browser computed them. */
export interface PaintedText {
  color: string
  /** The element first, then each ancestor outward. */
  layers: { background: string; opacity: string }[]
}

/** Reads the computed styles that `textContrast` judges. Background images are not read. */
export async function paintedText(element: Locator): Promise<PaintedText> {
  return element.evaluate((node) => {
    const layers: { background: string; opacity: string }[] = []
    for (let layer: Element | null = node; layer; layer = layer.parentElement) {
      const { backgroundColor, opacity } = getComputedStyle(layer)
      layers.push({ background: backgroundColor, opacity })
    }
    return { color: getComputedStyle(node).color, layers }
  })
}

/**
 * WCAG 2 contrast ratio of text against the nearest opaque background behind it, with the text's
 * own alpha and every translucent background between them composited. Throws rather than guess
 * when no background is opaque, when a layer has an opacity below 1, or when a color is not in
 * `rgb()` or `rgba()` notation.
 */
export function textContrast({ color, layers }: PaintedText): number {
  const seeThrough = layers.find(({ opacity }) => opacity !== '1')
  if (seeThrough) {
    throw new Error(`A layer behind the text has opacity ${seeThrough.opacity}`)
  }
  const backgrounds = layers.map(({ background }) => parse(background))
  const opaque = backgrounds.findIndex(({ alpha }) => alpha === 1)
  if (opaque === -1) {
    throw new Error('No opaque background lies behind the text')
  }
  const backdrop = backgrounds
    .slice(0, opaque)
    .reduceRight((below, paint) => over(paint, below), backgrounds[opaque].channels)
  return contrast(over(parse(color), backdrop), backdrop)
}

interface Paint {
  channels: number[]
  alpha: number
}

function parse(computed: string): Paint {
  const [red, green, blue, alpha = 1] = (/^rgba?\(([^)]+)\)$/.exec(computed)?.[1] ?? '')
    .split(',')
    .map(Number)
  const paint = { channels: [red, green, blue], alpha }
  if (![...paint.channels, alpha].every(Number.isFinite)) {
    throw new Error(`Cannot read the computed color ${computed}`)
  }
  return paint
}

function over({ channels, alpha }: Paint, below: number[]): number[] {
  return channels.map((channel, index) => alpha * channel + (1 - alpha) * below[index])
}
