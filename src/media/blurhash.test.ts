import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeBlurHashToDataUrl } from './blurhash'

// Distinct per test: the module-level memoization cache is shared across cases in this file, so
// reusing a hash would make an earlier test's decode silently satisfy a later test's assertions.
const HASH_DECODE = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
const HASH_MEMOIZE = 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH'
const HASH_NO_CONTEXT = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4'

describe('decodeBlurHashToDataUrl', () => {
  let toDataURL: ReturnType<typeof vi.fn<(type?: string, quality?: number) => string>>
  let putImageData: ReturnType<typeof vi.fn>

  beforeEach(() => {
    toDataURL = vi.fn(() => 'data:image/png;base64,decoded')
    putImageData = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData,
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(toDataURL)
  })

  it('decodes a valid hash to a data URL', () => {
    expect(decodeBlurHashToDataUrl(HASH_DECODE)).toBe('data:image/png;base64,decoded')
    expect(putImageData).toHaveBeenCalledTimes(1)
  })

  it('memoizes by hash string instead of redecoding', () => {
    decodeBlurHashToDataUrl(HASH_MEMOIZE)
    decodeBlurHashToDataUrl(HASH_MEMOIZE)
    expect(toDataURL).toHaveBeenCalledTimes(1)
  })

  it('returns null for an invalid hash without touching the canvas', () => {
    expect(decodeBlurHashToDataUrl('not-a-blurhash')).toBeNull()
    expect(toDataURL).not.toHaveBeenCalled()
  })

  it('returns null when the canvas has no 2d context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(decodeBlurHashToDataUrl(HASH_NO_CONTEXT)).toBeNull()
  })
})
