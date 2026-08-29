// The server derives these role-named slots per title (AmbientColors.theme). A slot maps to the
// same surface whether the theme is dark or bright, so nothing here branches on which it got.
export interface AmbientTheme {
  base: string
  panel: string
  selected: string
  accent: string
  onAccent: string
  textPrimary: string
  textSecondary: string
}

export interface AmbientColors {
  topLeft: string
  topRight: string
  bottomRight: string
  bottomLeft: string
  primary: string
  theme: AmbientTheme
}
