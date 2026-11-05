// The first token that names the browser wins: Edge and Opera also name Chrome, and every
// browser on iOS also names Safari. Chromium reports only its major version; Safari's minor
// version names a release of its own.
const BROWSERS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'Edge', pattern: /Edg(?:e|A|iOS)?\/(\d+)/ },
  { name: 'Opera', pattern: /OPR\/(\d+)/ },
  { name: 'Firefox', pattern: /(?:Firefox|FxiOS)\/(\d+)/ },
  { name: 'Chrome', pattern: /(?:Chrome|CriOS)\/(\d+)/ },
  // Desktop Safari ends "Version/17.4.1 Safari/…", and iOS puts its Mobile token between.
  {
    name: 'Safari',
    pattern: /Version\/(\d+(?:\.\d+)?)(?:\.\d+)* (?:Mobile\/\S+ )?Safari\//,
  },
]

/** A browser's name and the version it reports, such as Chrome and 141. */
export interface BrowserVersion {
  name: string
  version: string
}

/** The browser's name and version from its user agent; null for a browser it does not name. */
export function browserOf(userAgent: string): BrowserVersion | null {
  for (const { name, pattern } of BROWSERS) {
    const version = pattern.exec(userAgent)?.[1]
    if (version) {
      return { name, version }
    }
  }
  return null
}

/** The browser's name and version from its user agent, such as Chrome 141 or Safari 27.2. */
export function browserText(userAgent: string): string {
  return browserVersionText(browserOf(userAgent))
}

/** A browser's name and version, such as Chrome 141; Unknown for none. */
export function browserVersionText(browser: BrowserVersion | null | undefined): string {
  return browser ? `${browser.name} ${browser.version}` : 'Unknown'
}
