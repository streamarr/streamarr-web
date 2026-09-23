import { decode, isBlurhashValid } from 'blurhash'

const PLACEHOLDER_SIZE = 32
const MAX_PLACEHOLDERS = 512

// Decoding is real per-pixel DCT work, and a grid renders dozens of unique blurhashes — memoize
// by hash string, retaining at most 512 placeholders so earlier libraries can be reclaimed.
const decoded = new Map<string, string | null>()

export function decodeBlurHashToDataUrl(hash: string): string | null {
  const cached = decoded.get(hash)
  if (cached !== undefined) {
    return cached
  }

  const dataUrl = decodeToDataUrl(hash)
  decoded.set(hash, dataUrl)
  if (decoded.size > MAX_PLACEHOLDERS) {
    decoded.delete(decoded.keys().next().value!)
  }
  return dataUrl
}

function decodeToDataUrl(hash: string): string | null {
  if (!isBlurhashValid(hash).result) {
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = PLACEHOLDER_SIZE
  canvas.height = PLACEHOLDER_SIZE
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }

  const pixels = decode(hash, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE)
  const imageData = context.createImageData(PLACEHOLDER_SIZE, PLACEHOLDER_SIZE)
  imageData.data.set(pixels)
  context.putImageData(imageData, 0, 0)
  return canvas.toDataURL()
}
