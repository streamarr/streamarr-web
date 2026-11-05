import { describe, expect, it } from 'vitest'
import { CHROME_USER_AGENT, IPHONE_SAFARI_USER_AGENT } from '../test/playbackCapabilities'
import { browserText } from './browserText'

describe('browserText', () => {
  it.each([
    ['Chrome', CHROME_USER_AGENT, 'Chrome 141'],
    [
      'headless Chrome',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/142.0.7444.0 Safari/537.36',
      'Chrome 142',
    ],
    [
      'Chrome on iOS',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.46 Mobile/15E148 Safari/604.1',
      'Chrome 142',
    ],
    [
      'Edge',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.71',
      'Edge 141',
    ],
    [
      'Opera',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0',
      'Opera 124',
    ],
    [
      'Firefox',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:146.0) Gecko/20100101 Firefox/146.0',
      'Firefox 146',
    ],
    [
      'Firefox on iOS',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/146.0 Mobile/15E148 Safari/605.1.15',
      'Firefox 146',
    ],
    ['Safari', IPHONE_SAFARI_USER_AGENT, 'Safari 27.2'],
    [
      'desktop Safari',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
      'Safari 26.1',
    ],
    ['an unknown browser', 'SomeTV/1.0', 'Unknown'],
  ])('shouldNameTheBrowserAndItsVersionWhenTheUserAgentIs(%s)', (_, userAgent, named) => {
    expect(browserText(userAgent)).toBe(named)
  })
})
