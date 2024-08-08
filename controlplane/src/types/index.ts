import { LintSeverity } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { JWTPayload } from 'jose';
import { LintRuleEnum } from '../db/models.js';

export type FeatureIds =
  | 'users'
  | 'federated-graphs'
  | 'analytics-retention'
  | 'tracing-retention'
  | 'changelog-retention'
  | 'breaking-change-retention'
  | 'trace-sampling-rate'
  | 'requests'
  | 'feature-flags'
  // Boolean features
  | 'rbac'
  | 'sso'
  | 'security'
  | 'support'
  | 'ai'
  | 'oidc'
  | 'scim';

export type Features = {
  [key in FeatureIds]: Feature;
};

export type Feature = {
  id: FeatureIds;
  enabled?: boolean | null;
  limit?: number | null;
};

export interface ListFilterOptions {
  namespaceId?: string;
  limit: number;
  offset: number;
  query?: string;
}

export interface FederatedGraphListFilterOptions extends ListFilterOptions {
  supportsFederation?: boolean;
}

export interface SubgraphListFilterOptions extends ListFilterOptions {
  excludeFeatureSubgraphs: boolean;
}

export interface Label {
  key: string;
  value: string;
}

export interface ContractDTO {
  id: string;
  sourceFederatedGraphId: string;
  downstreamFederatedGraphId: string;
  excludeTags: string[];
}

export interface FederatedGraphDTO {
  id: string;
  targetId: string;
  name: string;
  routingUrl: string;
  lastUpdatedAt: string;
  isComposable: boolean;
  compositionErrors?: string;
  schemaVersionId?: string;
  labelMatchers: string[];
  subgraphsCount: number;
  composedSchemaVersionId?: string;
  admissionWebhookURL?: string;
  admissionWebhookSecret?: string;
  compositionId?: string;
  creatorUserId?: string;
  readme?: string;
  namespace: string;
  namespaceId: string;
  supportsFederation: boolean;
  contract?: ContractDTO;
}

export interface FederatedGraphChangelogDTO {
  schemaVersionId: string;
  createdAt: string;
  changelogs: {
    id: string;
    path: string;
    changeType: string;
    changeMessage: string;
    createdAt: string;
  }[];
  compositionId: string;
}

export interface SubgraphDTO {
  id: string;
  targetId: string;
  name: string;
  routingUrl: string;
  subscriptionUrl: string;
  subscriptionProtocol: 'ws' | 'sse' | 'sse_post';
  schemaSDL: string;
  schemaVersionId: string;
  lastUpdatedAt: string;
  labels: Label[];
  namespace: string;
  namespaceId: string;
  isEventDrivenGraph: boolean;
  creatorUserId?: string;
  isV2Graph?: boolean;
  readme?: string;
  websocketSubprotocol?: 'auto' | 'graphql-ws' | 'graphql-transport-ws';
  isFeatureSubgraph: boolean;
}

export interface FeatureSubgraphDTO extends SubgraphDTO {
  baseSubgraphId: string;
  baseSubgraphName: string;
}

export interface FeatureFlagDTO {
  id: string;
  name: string;
  namespace: string;
  namespaceId: string;
  labels: Label[];
  creatorUserId?: string;
  createdBy: string;
  isEnabled: boolean;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  featureSubgraphs: FeatureSubgraphDTO[];
}

export interface MigrationSubgraph {
  name: string;
  routingURL: string;
  schema: string;
}

export interface SchemaCheckDTO {
  id: string;
  targetID: string;
  subgraphName: string;
  timestamp: string;
  isComposable: boolean;
  isBreaking: boolean;
  hasClientTraffic: boolean;
  isForcedSuccess: boolean;
  isDeleted: boolean;
  ghDetails?: {
    commitSha: string;
    ownerSlug: string;
    repositorySlug: string;
    checkRunId: number;
  };
  hasLintErrors: boolean;
}

export interface SchemaCheckSummaryDTO extends SchemaCheckDTO {
  proposedSubgraphSchemaSDL?: string;
  affectedGraphs: {
    id: string;
    trafficCheckDays: number;
  }[];
}

export interface GetChecksResponse {
  checks: SchemaCheckDTO[];
  checksCount: number;
}

export interface SchemaCheckDetailsDTO {
  changes: {
    id: string;
    changeType: string;
    message: string;
    path?: string;
    isBreaking: boolean;
  }[];
  compositionErrors: string[];
}

export interface OrganizationDTO {
  id: string;
  name: string;
  slug: string;
  creatorUserId?: string;
  createdAt: string;
  features?: Feature[];
  billing?: {
    plan: string;
    email?: string;
  };
  subscription?: {
    status: string;
    trialEnd?: string;
    currentPeriodEnd?: string;
    cancelAtPeriodEnd?: boolean;
  };
  deactivation?: {
    reason?: string;
    initiatedAt: string;
  };
}

export interface UserDTO {
  id: string;
  email: string;
}

export interface OrganizationMemberDTO {
  userID: string;
  orgMemberID: string;
  email: string;
  roles: string[];
  active: boolean;
}

export interface OrganizationInvitationDTO {
  userID: string;
  email: string;
  invitedBy?: string;
}

export interface APIKeyDTO {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  createdBy: string;
  creatorUserID: string;
}

export interface WebhooksConfigDTO {
  id: string;
  endpoint: string;
  events: string[];
}

export interface ResponseMessage {
  response?: {
    code: number;
    details?: string;
  };
}

export interface BillingPlanDTO {
  id: string;
  name: string;
  price: number;
  features: {
    id: string;
    description: string;
    limit?: number;
  }[];
}

// https://github.com/kamilkisiela/graphql-inspector/blob/f3b9ed7e277f1a4928da7d0fdc212685ff77752a/packages/core/src/diff/changes/change.ts
export enum SchemaChangeType {
  FIELD_ARGUMENT_DESCRIPTION_CHANGED = 'FIELD_ARGUMENT_DESCRIPTION_CHANGED',
  FIELD_ARGUMENT_DEFAULT_CHANGED = 'FIELD_ARGUMENT_DEFAULT_CHANGED',
  FIELD_ARGUMENT_TYPE_CHANGED = 'FIELD_ARGUMENT_TYPE_CHANGED',
  DIRECTIVE_REMOVED = 'DIRECTIVE_REMOVED',
  DIRECTIVE_ADDED = 'DIRECTIVE_ADDED',
  DIRECTIVE_DESCRIPTION_CHANGED = 'DIRECTIVE_DESCRIPTION_CHANGED',
  DIRECTIVE_LOCATION_ADDED = 'DIRECTIVE_LOCATION_ADDED',
  DIRECTIVE_LOCATION_REMOVED = 'DIRECTIVE_LOCATION_REMOVED',
  DIRECTIVE_ARGUMENT_ADDED = 'DIRECTIVE_ARGUMENT_ADDED',
  DIRECTIVE_ARGUMENT_REMOVED = 'DIRECTIVE_ARGUMENT_REMOVED',
  DIRECTIVE_ARGUMENT_DESCRIPTION_CHANGED = 'DIRECTIVE_ARGUMENT_DESCRIPTION_CHANGED',
  DIRECTIVE_ARGUMENT_DEFAULT_VALUE_CHANGED = 'DIRECTIVE_ARGUMENT_DEFAULT_VALUE_CHANGED',
  DIRECTIVE_ARGUMENT_TYPE_CHANGED = 'DIRECTIVE_ARGUMENT_TYPE_CHANGED',
  ENUM_VALUE_REMOVED = 'ENUM_VALUE_REMOVED',
  ENUM_VALUE_ADDED = 'ENUM_VALUE_ADDED',
  ENUM_VALUE_DESCRIPTION_CHANGED = 'ENUM_VALUE_DESCRIPTION_CHANGED',
  ENUM_VALUE_DEPRECATION_REASON_CHANGED = 'ENUM_VALUE_DEPRECATION_REASON_CHANGED',
  ENUM_VALUE_DEPRECATION_REASON_ADDED = 'ENUM_VALUE_DEPRECATION_REASON_ADDED',
  ENUM_VALUE_DEPRECATION_REASON_REMOVED = 'ENUM_VALUE_DEPRECATION_REASON_REMOVED',
  FIELD_REMOVED = 'FIELD_REMOVED',
  FIELD_ADDED = 'FIELD_ADDED',
  FIELD_DESCRIPTION_CHANGED = 'FIELD_DESCRIPTION_CHANGED',
  FIELD_DESCRIPTION_ADDED = 'FIELD_DESCRIPTION_ADDED',
  FIELD_DESCRIPTION_REMOVED = 'FIELD_DESCRIPTION_REMOVED',
  FIELD_DEPRECATION_ADDED = 'FIELD_DEPRECATION_ADDED',
  FIELD_DEPRECATION_REMOVED = 'FIELD_DEPRECATION_REMOVED',
  FIELD_DEPRECATION_REASON_CHANGED = 'FIELD_DEPRECATION_REASON_CHANGED',
  FIELD_DEPRECATION_REASON_ADDED = 'FIELD_DEPRECATION_REASON_ADDED',
  FIELD_DEPRECATION_REASON_REMOVED = 'FIELD_DEPRECATION_REASON_REMOVED',
  FIELD_TYPE_CHANGED = 'FIELD_TYPE_CHANGED',
  FIELD_ARGUMENT_ADDED = 'FIELD_ARGUMENT_ADDED',
  FIELD_ARGUMENT_REMOVED = 'FIELD_ARGUMENT_REMOVED',
  INPUT_FIELD_REMOVED = 'INPUT_FIELD_REMOVED',
  INPUT_FIELD_ADDED = 'INPUT_FIELD_ADDED',
  INPUT_FIELD_DESCRIPTION_ADDED = 'INPUT_FIELD_DESCRIPTION_ADDED',
  INPUT_FIELD_DESCRIPTION_REMOVED = 'INPUT_FIELD_DESCRIPTION_REMOVED',
  INPUT_FIELD_DESCRIPTION_CHANGED = 'INPUT_FIELD_DESCRIPTION_CHANGED',
  INPUT_FIELD_DEFAULT_VALUE_CHANGED = 'INPUT_FIELD_DEFAULT_VALUE_CHANGED',
  INPUT_FIELD_TYPE_CHANGED = 'INPUT_FIELD_TYPE_CHANGED',
  OBJECT_TYPE_INTERFACE_ADDED = 'OBJECT_TYPE_INTERFACE_ADDED',
  OBJECT_TYPE_INTERFACE_REMOVED = 'OBJECT_TYPE_INTERFACE_REMOVED',
  SCHEMA_QUERY_TYPE_CHANGED = 'SCHEMA_QUERY_TYPE_CHANGED',
  SCHEMA_MUTATION_TYPE_CHANGED = 'SCHEMA_MUTATION_TYPE_CHANGED',
  SCHEMA_SUBSCRIPTION_TYPE_CHANGED = 'SCHEMA_SUBSCRIPTION_TYPE_CHANGED',
  TYPE_REMOVED = 'TYPE_REMOVED',
  TYPE_ADDED = 'TYPE_ADDED',
  TYPE_KIND_CHANGED = 'TYPE_KIND_CHANGED',
  TYPE_DESCRIPTION_CHANGED = 'TYPE_DESCRIPTION_CHANGED',
  TYPE_DESCRIPTION_REMOVED = 'TYPE_DESCRIPTION_REMOVED',
  TYPE_DESCRIPTION_ADDED = 'TYPE_DESCRIPTION_ADDED',
  UNION_MEMBER_REMOVED = 'UNION_MEMBER_REMOVED',
  UNION_MEMBER_ADDED = 'UNION_MEMBER_ADDED',
}

export interface JWTEncodeParams<Payload extends JWTPayload = JWTPayload, Secret = string> {
  // The payload to encode into the JWT
  token: Payload;
  // The secret used to encode the issued JWT
  secret: Secret;
  // The maximum age of the issued JWT in seconds
  maxAgeInSeconds?: number;
}

export interface JWTDecodeParams {
  /** The issued JWT to be decoded */
  token?: string;
  /** The secret used to decode the issued JWT. */
  secret: string | Buffer;
}

export interface UserSession extends JWTPayload {
  sessionId: string;
}

export type PKCECodeChallenge = {
  codeVerifier: string;
};

export type CustomAccessTokenClaims = {
  email: string;
  preferred_username: string;
  groups?: string[];
};

export type UserInfoEndpointResponse = {
  preferred_username: string;
  name: string;
  email_verified: boolean;
  sub: string;
  given_name: string;
  family_name: string;
  email: string;
  groups: string[];
};

export type AuthContext = {
  auth: 'access_token' | 'api_key' | 'cookie';
  organizationId: string;
  organizationSlug: string;
  hasWriteAccess: boolean;
  isAdmin: boolean;
  userId: string;
  userDisplayName: string;
};

export interface GraphApiKeyJwtPayload extends JWTPayload {
  federated_graph_id: string;
  organization_id: string;
}

export interface GraphApiKeyDTO {
  id: string;
  name: string;
  token: string;
  lastUsedAt?: string;
  createdAt: string;
  creatorEmail: string | null;
}

export interface RouterRequestKeysDTO {
  id: string;
  privateKey: string;
  publicKey: string;
  createdAt: string;
}

export interface SlackAccessTokenResponse {
  slackUserId: string;
  accessToken: string;
  slackOrgId: string;
  slackOrgName: string;
  slackChannelId: string;
  slackChannelName: string;
  webhookURL: string;
}

export interface ClientDTO {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  lastUpdatedAt: string;
  lastUpdatedBy: string;
}

export interface PersistedOperationDTO {
  id: string;
  operationId: string;
  hash: string;
  filePath: string;
  createdAt: string;
  createdBy?: string;
  lastUpdatedAt: string;
  lastUpdatedBy: string;
  contents: string;
  operationNames: string[];
}

export interface PublishedOperationData {
  version: 1;
  body: string;
}

export interface UpdatedPersistedOperation {
  operationId: string;
  hash: string;
  filePath: string;
  contents: string;
  operationNames: string[];
}

export interface GraphCompositionDTO {
  id: string;
  schemaVersionId: string;
  createdAt: string;
  createdBy?: string;
  compositionErrors?: string;
  routerConfigSignature?: string;
  isComposable: boolean;
  isLatestValid: boolean;
  admissionError?: string;
  deploymentError?: string;
}

export interface FeatureFlagCompositionDTO {
  id: string;
  schemaVersionId: string;
  createdAt: string;
  featureFlagName: string;
  createdBy?: string;
  compositionErrors?: string;
  routerConfigSignature?: string;
  isComposable: boolean;
  admissionError?: string;
  deploymentError?: string;
}

export interface SubgraphMemberDTO {
  userId: string;
  subgraphMemberId: string;
  email: string;
}

export type DiscussionDTO = {
  id: string;
  createdAt: Date;
  targetId: string;
  schemaVersionId: string;
  referenceLine: number;
  isResolved: boolean;
  thread: DiscussionThreadDTO;
}[];

export type DiscussionThreadDTO = {
  id: string;
  createdAt: Date;
  discussionId: string;
  contentMarkdown: string | null;
  contentJson: unknown;
  updatedAt: Date | null;
  createdById: string | null;
  isDeleted: boolean;
}[];
export interface SubgraphLatencyResult {
  subgraphID: string;
  latency: number;
}

export interface SubgraphRequestRateResult {
  subgraphID: string;
  requestRate: number;
  errorRate: number;
}

export interface FederatedGraphRequestRateResult {
  federatedGraphID: string;
  requestRate: number;
  errorRate: number;
}

export interface DateRange<T extends string | number = string> {
  start: T;
  end: T;
}

export type TimeFilters = {
  granule: string;
  dateRange: DateRange<number>;
};

export interface MailerParams {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpRequireTls: boolean;
  smtpUsername: string;
  smtpPassword: string;
}

type LintRuleType = Record<LintRuleEnum, LintRuleEnum>;

// when the rules are changed, it has to be changed in the constants.ts file in the studio to maintain consistency.
export const LintRules: LintRuleType = {
  FIELD_NAMES_SHOULD_BE_CAMEL_CASE: 'FIELD_NAMES_SHOULD_BE_CAMEL_CASE',
  TYPE_NAMES_SHOULD_BE_PASCAL_CASE: 'TYPE_NAMES_SHOULD_BE_PASCAL_CASE',
  SHOULD_NOT_HAVE_TYPE_PREFIX: 'SHOULD_NOT_HAVE_TYPE_PREFIX',
  SHOULD_NOT_HAVE_TYPE_SUFFIX: 'SHOULD_NOT_HAVE_TYPE_SUFFIX',
  SHOULD_NOT_HAVE_INPUT_PREFIX: 'SHOULD_NOT_HAVE_INPUT_PREFIX',
  SHOULD_HAVE_INPUT_SUFFIX: 'SHOULD_HAVE_INPUT_SUFFIX',
  SHOULD_NOT_HAVE_ENUM_PREFIX: 'SHOULD_NOT_HAVE_ENUM_PREFIX',
  SHOULD_NOT_HAVE_ENUM_SUFFIX: 'SHOULD_NOT_HAVE_ENUM_SUFFIX',
  SHOULD_NOT_HAVE_INTERFACE_PREFIX: 'SHOULD_NOT_HAVE_INTERFACE_PREFIX',
  SHOULD_NOT_HAVE_INTERFACE_SUFFIX: 'SHOULD_NOT_HAVE_INTERFACE_SUFFIX',
  ENUM_VALUES_SHOULD_BE_UPPER_CASE: 'ENUM_VALUES_SHOULD_BE_UPPER_CASE',
  ORDER_FIELDS: 'ORDER_FIELDS',
  ORDER_ENUM_VALUES: 'ORDER_ENUM_VALUES',
  ORDER_DEFINITIONS: 'ORDER_DEFINITIONS',
  ALL_TYPES_REQUIRE_DESCRIPTION: 'ALL_TYPES_REQUIRE_DESCRIPTION',
  DISALLOW_CASE_INSENSITIVE_ENUM_VALUES: 'DISALLOW_CASE_INSENSITIVE_ENUM_VALUES',
  NO_TYPENAME_PREFIX_IN_TYPE_FIELDS: 'NO_TYPENAME_PREFIX_IN_TYPE_FIELDS',
  REQUIRE_DEPRECATION_REASON: 'REQUIRE_DEPRECATION_REASON',
};

export type Severity = 1 | 2;
export type LintSeverityLevel = 'warn' | 'error';
export type RuleLevel = Severity | LintSeverityLevel;
export type RuleLevelAndOptions<Options extends any[] = any[]> = Prepend<Partial<Options>, RuleLevel>;
export type RuleEntry<Options extends any[] = any[]> = RuleLevel | RuleLevelAndOptions<Options>;

export interface RulesConfig {
  [rule: string]: RuleEntry;
}

export interface LintIssueResult {
  lintRuleType: LintRuleEnum | undefined;
  severity: LintSeverity;
  message: string;
  issueLocation: {
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
  };
}

export interface SchemaLintDTO {
  severity: LintSeverityLevel;
  ruleName: LintRuleEnum;
}

export interface SchemaLintIssues {
  warnings: LintIssueResult[];
  errors: LintIssueResult[];
}
