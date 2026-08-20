/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type HouseholdRole =
  | 'ADMIN'
  | 'MEMBER'
  | '%future added value';

export type ProfileKind =
  | 'ADULT'
  | 'KID'
  | '%future added value';

export type TranscodeMode =
  | 'AUDIO_TRANSCODE'
  | 'FULL_TRANSCODE'
  | 'REMUX'
  | 'VIDEO_TRANSCODE'
  | '%future added value';

export type CreateStreamSessionMutationVariables = Exact<{
  mediaFileId: string | number;
}>;


export type CreateStreamSessionMutation = { createStreamSession: { id: string, streamUrl: string, transcodeMode: TranscodeMode } };

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { me: { accountId: string, email: string, displayName: string, serverAdmin: boolean, scope: string, deviceBound: boolean, householdRole: HouseholdRole, household: { id: string, name: string }, contextHousehold: { id: string, name: string }, usableHouseholds: { edges: Array<{ node: { membership: boolean, household: { id: string, name: string } } }> }, selectableProfiles: { edges: Array<{ node: { id: string, name: string, picture: string | null, kind: ProfileKind, personal: boolean, pinConfigured: boolean, locked: boolean, selected: boolean } }> }, selectedProfile: { id: string, name: string } | null } };


export const CreateStreamSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateStreamSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"mediaFileId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createStreamSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"mediaFileId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"mediaFileId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"streamUrl"}},{"kind":"Field","name":{"kind":"Name","value":"transcodeMode"}}]}}]}}]} as unknown as DocumentNode<CreateStreamSessionMutation, CreateStreamSessionMutationVariables>;
export const MeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"accountId"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"serverAdmin"}},{"kind":"Field","name":{"kind":"Name","value":"scope"}},{"kind":"Field","name":{"kind":"Name","value":"deviceBound"}},{"kind":"Field","name":{"kind":"Name","value":"householdRole"}},{"kind":"Field","name":{"kind":"Name","value":"household"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"contextHousehold"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"usableHouseholds"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"20"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"membership"}},{"kind":"Field","name":{"kind":"Name","value":"household"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectableProfiles"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"100"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"picture"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"personal"}},{"kind":"Field","name":{"kind":"Name","value":"pinConfigured"}},{"kind":"Field","name":{"kind":"Name","value":"locked"}},{"kind":"Field","name":{"kind":"Name","value":"selected"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]} as unknown as DocumentNode<MeQuery, MeQueryVariables>;