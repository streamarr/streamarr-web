import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import type { AmbientTheme } from './ambientTheme'

interface AmbientThemeStore {
  theme: AmbientTheme | null
  publish: (theme: AmbientTheme | null) => void
}

const AmbientThemeContext = createContext<AmbientThemeStore | null>(null)

// The page ground belongs to the root layout, but only a detail page knows its title's theme:
// the page publishes it here and the layout paints it around both the chrome and the page.
export function AmbientThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [theme, publish] = useState<AmbientTheme | null>(null)
  const store = useMemo(() => ({ theme, publish }), [theme])
  return <AmbientThemeContext.Provider value={store}>{children}</AmbientThemeContext.Provider>
}

function useStore(): AmbientThemeStore {
  const store = useContext(AmbientThemeContext)
  if (!store) {
    throw new Error('AmbientThemeProvider is missing above this component')
  }
  return store
}

/** The theme the current page has published; null while no page has one. */
export function useAmbientTheme(): AmbientTheme | null {
  return useStore().theme
}

/** A page's theme lasts exactly as long as the page: applied before paint, withdrawn on unmount. */
export function usePublishAmbientTheme(theme: AmbientTheme | null): void {
  const { publish } = useStore()
  useLayoutEffect(() => {
    publish(theme)
    return () => publish(null)
  }, [publish, theme])
}
