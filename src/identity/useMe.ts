import { useQuery } from '@apollo/client/react'
import { ME_QUERY } from '../graphql/operations'

export function useMe() {
  return useQuery(ME_QUERY)
}
