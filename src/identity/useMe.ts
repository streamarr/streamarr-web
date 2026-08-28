import { useQuery } from '@apollo/client/react'
import { MeDocument } from '../graphql/generated/graphql'

export function useMe() {
  return useQuery(MeDocument)
}
