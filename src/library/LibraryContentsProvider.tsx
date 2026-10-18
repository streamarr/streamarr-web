import { useApolloClient } from '@apollo/client/react'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createLibraryContents } from './libraryContents'

type Contents = ReturnType<typeof createLibraryContents>
const LibraryContentsContext = createContext<Contents | null>(null)

export function LibraryContentsProvider({
  profileId,
  pathname,
  children,
}: {
  profileId: string | undefined
  pathname: string
  children: ReactNode
}) {
  const client = useApolloClient()
  const [generation, setGeneration] = useState(0)
  const identity = profileId ? `${profileId}:${generation}` : null
  const contents = useMemo(
    () => (identity ? createLibraryContents({ client }) : null),
    [client, identity],
  )
  useEffect(() => {
    const reset = () => {
      contents?.dispose()
      setGeneration((value) => value + 1)
      return Promise.resolve()
    }
    const clear = client.onClearStore(reset)
    const resetStore = client.onResetStore(reset)
    return () => {
      clear()
      resetStore()
      contents?.dispose()
    }
  }, [client, contents])
  useEffect(() => contents?.leaveUnlessWithin(pathname), [contents, pathname])
  return (
    <LibraryContentsContext key={identity} value={contents}>
      {children}
    </LibraryContentsContext>
  )
}

export function useLibraryContents() {
  return useContext(LibraryContentsContext)
}
