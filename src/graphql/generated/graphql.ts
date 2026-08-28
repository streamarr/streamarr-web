/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type AcceptProfileShareInput = {
  shareId: string | number;
};

export type CancelProfileShareInput = {
  shareId: string | number;
};

export type EndProfileShareInput = {
  shareId: string | number;
};

export type HouseholdRole =
  | 'ADMIN'
  | 'MEMBER'
  | '%future added value';

export type ImageSize =
  | 'LARGE'
  | 'MEDIUM'
  | 'ORIGINAL'
  | 'SMALL'
  | '%future added value';

export type OfferProfileShareInput = {
  householdId: string | number;
  profileId: string | number;
};

export type ProfileKind =
  | 'ADULT'
  | 'KID'
  | '%future added value';

export type ProfileShareStatus =
  | 'ACTIVE'
  | 'CANCELED'
  | 'ENDED'
  | 'EXPIRED'
  | 'INVALIDATED'
  | 'PENDING'
  | 'REJECTED'
  | '%future added value';

export type RejectProfileShareInput = {
  shareId: string | number;
};

export type TranscodeMode =
  | 'AUDIO_TRANSCODE'
  | 'FULL_TRANSCODE'
  | 'REMUX'
  | 'VIDEO_TRANSCODE'
  | '%future added value';

export type WatchStatus =
  | 'IN_PROGRESS'
  | 'UNWATCHED'
  | 'WATCHED'
  | '%future added value';

export type CreateStreamSessionMutationVariables = Exact<{
  mediaFileId: string | number;
}>;


export type CreateStreamSessionMutation = { createStreamSession: { id: string, streamUrl: string, transcodeMode: TranscodeMode } };

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { me: { accountId: string, email: string, displayName: string, serverAdmin: boolean, scope: string, deviceBound: boolean, householdRole: HouseholdRole, household: { id: string, name: string }, contextHousehold: { id: string, name: string }, usableHouseholds: { edges: Array<{ node: { membership: boolean, household: { id: string, name: string } } }> }, selectableProfiles: { edges: Array<{ node: { id: string, name: string, picture: string | null, kind: ProfileKind, personal: boolean, pinConfigured: boolean, locked: boolean, selected: boolean } }> }, selectedProfile: { id: string, name: string } | null } };

export type SharingOverviewQueryVariables = Exact<{
  householdId: string | number;
  profileId: string | number;
}>;


export type SharingOverviewQuery = { pendingShareOffers: { edges: Array<{ node: { id: string, profileId: string, householdId: string, status: ProfileShareStatus, expiresAt: string | null } }> }, profileShares: { edges: Array<{ node: { id: string, householdId: string, status: ProfileShareStatus, requiredByAccountMembership: boolean } }> } };

export type ProfileSharePreviewQueryVariables = Exact<{
  profileId: string | number;
  householdId: string | number;
}>;


export type ProfileSharePreviewQuery = { profileSharePreview: { wouldLock: boolean, nameConflict: boolean } | null };

export type OfferProfileShareMutationVariables = Exact<{
  input: OfferProfileShareInput;
}>;


export type OfferProfileShareMutation = { offerProfileShare: { share: { id: string, status: ProfileShareStatus } | null, userErrors: Array<
      | { __typename: 'HouseholdNotFoundError', message: string }
      | { __typename: 'ProfileAlreadySharedError', message: string }
      | { __typename: 'ProfileNotFoundError', message: string }
    > } | null };

export type AcceptProfileShareMutationVariables = Exact<{
  input: AcceptProfileShareInput;
}>;


export type AcceptProfileShareMutation = { acceptProfileShare: { share: { id: string, status: ProfileShareStatus } | null, userErrors: Array<
      | { __typename: 'RestrictedProfileRequiresHouseholdAdminError', message: string }
      | { __typename: 'ShareNameConflictError', message: string }
      | { __typename: 'ShareNotFoundError', message: string }
      | { __typename: 'ShareNotPendingError', message: string }
    > } | null };

export type RejectProfileShareMutationVariables = Exact<{
  input: RejectProfileShareInput;
}>;


export type RejectProfileShareMutation = { rejectProfileShare: { share: { id: string, status: ProfileShareStatus } | null, userErrors: Array<
      | { __typename: 'ShareNotFoundError', message: string }
      | { __typename: 'ShareNotPendingError', message: string }
    > } | null };

export type CancelProfileShareMutationVariables = Exact<{
  input: CancelProfileShareInput;
}>;


export type CancelProfileShareMutation = { cancelProfileShare: { share: { id: string, status: ProfileShareStatus } | null, userErrors: Array<
      | { __typename: 'ShareNotFoundError', message: string }
      | { __typename: 'ShareNotPendingError', message: string }
    > } | null };

export type EndProfileShareMutationVariables = Exact<{
  input: EndProfileShareInput;
}>;


export type EndProfileShareMutation = { endProfileShare: { share: { id: string, status: ProfileShareStatus } | null, userErrors: Array<
      | { __typename: 'MembershipShareCannotEndError', message: string }
      | { __typename: 'ShareNotActiveError', message: string }
      | { __typename: 'ShareNotFoundError', message: string }
    > } | null };

type MediaSummaryFields_Movie_Fragment = { __typename: 'Movie', id: string, title: string | null, titleSort: string | null, releaseDate: string | null, runtime: number | null, watchStatus: WatchStatus, watchProgress: { percentComplete: number } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> };

type MediaSummaryFields_Series_Fragment = { __typename: 'Series', id: string, title: string | null, titleSort: string | null, firstAirDate: string | null, watchStatus: WatchStatus, seasons: Array<{ id: string } | null>, watchProgress: { percentComplete: number } | null, images: Array<{ aspectRatio: number, blurHash: string | null, variants: Array<{ id: string, size: ImageSize, width: number, height: number, url: string } | null> } | null> };

export type MediaSummaryFieldsFragment =
  | MediaSummaryFields_Movie_Fragment
  | MediaSummaryFields_Series_Fragment
;

export const MediaSummaryFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"MediaSummaryFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Media"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Movie"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"titleSort"}},{"kind":"Field","name":{"kind":"Name","value":"releaseDate"}},{"kind":"Field","name":{"kind":"Name","value":"runtime"}},{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Series"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"titleSort"}},{"kind":"Field","name":{"kind":"Name","value":"firstAirDate"}},{"kind":"Field","name":{"kind":"Name","value":"seasons"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"watchStatus"}},{"kind":"Field","name":{"kind":"Name","value":"watchProgress"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"percentComplete"}}]}},{"kind":"Field","name":{"kind":"Name","value":"images"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"type"},"value":{"kind":"EnumValue","value":"POSTER"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"blurHash"}},{"kind":"Field","name":{"kind":"Name","value":"variants"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}}]}}]} as unknown as DocumentNode<MediaSummaryFieldsFragment, unknown>;
export const CreateStreamSessionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateStreamSession"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"mediaFileId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createStreamSession"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"mediaFileId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"mediaFileId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"streamUrl"}},{"kind":"Field","name":{"kind":"Name","value":"transcodeMode"}}]}}]}}]} as unknown as DocumentNode<CreateStreamSessionMutation, CreateStreamSessionMutationVariables>;
export const MeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"accountId"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"serverAdmin"}},{"kind":"Field","name":{"kind":"Name","value":"scope"}},{"kind":"Field","name":{"kind":"Name","value":"deviceBound"}},{"kind":"Field","name":{"kind":"Name","value":"householdRole"}},{"kind":"Field","name":{"kind":"Name","value":"household"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"contextHousehold"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}},{"kind":"Field","name":{"kind":"Name","value":"usableHouseholds"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"20"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"membership"}},{"kind":"Field","name":{"kind":"Name","value":"household"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectableProfiles"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"100"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"picture"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"personal"}},{"kind":"Field","name":{"kind":"Name","value":"pinConfigured"}},{"kind":"Field","name":{"kind":"Name","value":"locked"}},{"kind":"Field","name":{"kind":"Name","value":"selected"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"selectedProfile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]}}]}}]} as unknown as DocumentNode<MeQuery, MeQueryVariables>;
export const SharingOverviewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SharingOverview"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"householdId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"profileId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"pendingShareOffers"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"householdId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"householdId"}}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"50"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"profileId"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"expiresAt"}}]}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"profileShares"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"profileId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"profileId"}}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"50"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"householdId"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"requiredByAccountMembership"}}]}}]}}]}}]}}]} as unknown as DocumentNode<SharingOverviewQuery, SharingOverviewQueryVariables>;
export const ProfileSharePreviewDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"ProfileSharePreview"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"profileId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"householdId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"profileSharePreview"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"profileId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"profileId"}}},{"kind":"Argument","name":{"kind":"Name","value":"householdId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"householdId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"wouldLock"}},{"kind":"Field","name":{"kind":"Name","value":"nameConflict"}}]}}]}}]} as unknown as DocumentNode<ProfileSharePreviewQuery, ProfileSharePreviewQueryVariables>;
export const OfferProfileShareDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"OfferProfileShare"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"OfferProfileShareInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"offerProfileShare"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"share"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<OfferProfileShareMutation, OfferProfileShareMutationVariables>;
export const AcceptProfileShareDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"AcceptProfileShare"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"AcceptProfileShareInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"acceptProfileShare"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"share"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<AcceptProfileShareMutation, AcceptProfileShareMutationVariables>;
export const RejectProfileShareDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"RejectProfileShare"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"RejectProfileShareInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"rejectProfileShare"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"share"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<RejectProfileShareMutation, RejectProfileShareMutationVariables>;
export const CancelProfileShareDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CancelProfileShare"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"CancelProfileShareInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cancelProfileShare"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"share"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<CancelProfileShareMutation, CancelProfileShareMutationVariables>;
export const EndProfileShareDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"EndProfileShare"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"EndProfileShareInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"endProfileShare"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"share"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"userErrors"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"__typename"}},{"kind":"InlineFragment","typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"MutationError"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"message"}}]}}]}}]}}]}}]} as unknown as DocumentNode<EndProfileShareMutation, EndProfileShareMutationVariables>;