export type PreferredImageSize = 'SMALL' | 'MEDIUM' | 'LARGE' | 'ORIGINAL'

interface ImageVariantLike {
  size: string
  url: string
}

interface ImageLike {
  aspectRatio: number
  variants: readonly (ImageVariantLike | null)[]
}

export interface PickedImage {
  url: string
  aspectRatio: number
}

// The schema gives no size-filtering argument: `variants` always comes back in full, and the
// caller picks one client-side.
export function pickImageVariant(
  image: ImageLike | null | undefined,
  preferred: PreferredImageSize,
): PickedImage | null {
  if (!image) return null
  const variants = image.variants.filter((variant): variant is ImageVariantLike => variant !== null)
  const match = variants.find((variant) => variant.size === preferred) ?? variants[0]
  return match ? { url: match.url, aspectRatio: image.aspectRatio } : null
}
