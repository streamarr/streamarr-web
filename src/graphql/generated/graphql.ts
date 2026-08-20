/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
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


export type MeQuery = { me: { accountId: string, email: string, displayName: string, role: string, scope: string, memberships: Array<{ householdId: string, householdName: string, householdRole: string, profiles: Array<{ id: string, name: string, active: boolean }> }> } };


export const CreateStreamSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateStreamSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"mediaFileId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createStreamSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"mediaFileId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"mediaFileId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"streamUrl"}},{"kind":"Field","name":{"kind":"Name","value":"transcodeMode"}}]}}]}}]} as unknown as DocumentNode<CreateStreamSessionMutation, CreateStreamSessionMutationVariables>;
export const MeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"accountId"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"scope"}},{"kind":"Field","name":{"kind":"Name","value":"memberships"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"householdName"}},{"kind":"Field","name":{"kind":"Name","value":"householdRole"}},{"kind":"Field","name":{"kind":"Name","value":"profiles"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"active"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MeQuery, MeQueryVariables>;