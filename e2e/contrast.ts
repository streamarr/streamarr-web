/** WCAG 2 contrast ratio between two sRGB colors with channels from 0 to 255. */
export function contrast(one: number[], other: number[]): number {
  const luminance = (color: number[]) => {
    const [red, green, blue] = color.map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const [lighter, darker] = [luminance(one), luminance(other)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}
