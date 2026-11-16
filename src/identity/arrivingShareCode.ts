import { createContext, useContext } from 'react'

/** The share code that the Sharing page's link carried, until the share form takes it. */
export interface ArrivingShareCode {
  code: string | null
  /** The form has the code: no later form opens with it, so it is looked up once. */
  take: () => void
}

export const ArrivingShareCodeContext = createContext<ArrivingShareCode>({
  code: null,
  take: () => {},
})

export function useArrivingShareCode(): ArrivingShareCode {
  return useContext(ArrivingShareCodeContext)
}
