import type { Page } from '@playwright/test'

// One keyboard focus ring, set in the theme: 2px sky, 2px out, on Mantine's controls and ours.
export const RING = { outline: '2px solid rgb(92, 192, 232)', offset: '2px' }

export async function ringOnActiveElement(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement
    const style = getComputedStyle(active)
    return {
      name: active.textContent?.trim(),
      outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`,
      offset: style.outlineOffset,
    }
  })
}
