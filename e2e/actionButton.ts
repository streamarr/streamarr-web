import type { Locator, Page } from '@playwright/test'

// Every labelled action takes radius.md on every client (streamarr-ux components.yaml, ActionButton).
export async function actionButtonRadius(page: Page) {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--radius-md').trim(),
  )
}

export async function cornerRadii(actions: Locator[]) {
  return Promise.all(
    actions.map((action) =>
      action.evaluate((element) => getComputedStyle(element).borderTopLeftRadius),
    ),
  )
}
