import { gql, type TypedDocumentNode } from '@apollo/client'

export interface SelectableProfile {
  id: string
  name: string
  active: boolean
}

export interface Membership {
  householdId: string
  householdName: string
  householdRole: string
  profiles: SelectableProfile[]
}

export interface Me {
  accountId: string
  email: string
  displayName: string
  role: string
  scope: string
  memberships: Membership[]
}

export const ME_QUERY: TypedDocumentNode<{ me: Me }> = gql`
  query Me {
    me {
      accountId
      email
      displayName
      role
      scope
      memberships {
        householdId
        householdName
        householdRole
        profiles {
          id
          name
          active
        }
      }
    }
  }
`

export interface StreamSession {
  id: string
  streamUrl: string
  transcodeMode: string
}

export const CREATE_STREAM_SESSION: TypedDocumentNode<
  { createStreamSession: StreamSession },
  { mediaFileId: string }
> = gql`
  mutation CreateStreamSession($mediaFileId: ID!) {
    createStreamSession(mediaFileId: $mediaFileId) {
      id
      streamUrl
      transcodeMode
    }
  }
`
