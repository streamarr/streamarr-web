// The first token that names the browser wins: Edge and Opera also name Chrome, and every
// browser on iOS also names Safari. Chromium reports only its major version; Safari's minor
// version names a release of its own.
const BROWSERS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'Edge', pattern: /Edg(?:e|A|iOS)?\/(\d+)/ },
  { name: 'Opera', pattern: /OPR\/(\d+)/ },
  { name: 'Firefox', pattern: /(?:Firefox|FxiOS)\/(\d+)/ },
  { name: 'Chrome', pattern: /(?:Chrome|CriOS)\/(\d+)/ },
  { name: 'Safari', pattern: /Version\/(\d+(?:\.\d+)?).*Safari\// },
]

/** The browser's name and version from its user agent, such as Chrome 141 or Safari 27.2. */
export function browserText(userAgent: string): string {
  for (const { name, pattern } of BROWSERS) {
    const version = pattern.exec(userAgent)?.[1]
    if (version) {
      return `${name} ${version}`
    }
  }
  return 'Unknown'
}
