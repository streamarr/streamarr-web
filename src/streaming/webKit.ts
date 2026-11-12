/**
 * Whether the user agent is WebKit's. Every iPhone browser is WebKit; Blink keeps AppleWebKit in its
 * user agent beside Chrome/.
 */
export function isWebKit(userAgent: string): boolean {
  return /AppleWebKit\//.test(userAgent) && !/\b(?:Chrome|Chromium)\//.test(userAgent)
}
