import { useQuery } from '@apollo/client/react'
import { LibrariesDocument } from '../graphql/generated/graphql'

export function useLibraries() {
  return useQuery(LibrariesDocument)
}
