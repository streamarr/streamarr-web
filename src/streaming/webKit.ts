/**
 * Whether the user agent is WebKit's. Every iPhone browser is WebKit; Blink keeps AppleWebKit in its
 * user agent beside Chrome/, or HeadlessChrome/ when headless.
 */
export function isWebKit(userAgent: string): boolean {
  return /AppleWebKit\//.test(userAgent) && !/(?:Chrome|Chromium)\//.test(userAgent)
}
