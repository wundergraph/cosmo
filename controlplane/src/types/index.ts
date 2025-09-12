import { LintSeverity } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { JWTPayload } from 'jose';
import { DBSubgraphType, GraphPruningRuleEnum, LintRuleEnum, OrganizationRole, ProposalMatch } from '../db/models.js';
import { RBACEvaluator } from '../core/services/RBACEvaluator.js';

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
  | 'scim'
  | 'field-pruning-grace-period'
  | 'cache-warmer'
  | 'proposals'
  | 'plugins';

export type Features = {
  [key in FeatureIds]: Feature;
};

export type Feature = {
  id: FeatureIds;
  enabled?: boolean | null;
  limit?: number | null;
};

export interface ListFilterOptions {
  namespaceIds?: string[];
  limit: number;
  offset: number;
  query?: string;
}

export interface FederatedGraphListFilterOptions extends ListFilterOptions {
  supportsFederation?: boolean;
  rbac?: RBACEvaluator;
}

export interface SubgraphListFilterOptions extends ListFilterOptions {
  excludeFeatureSubgraphs: boolean;
  rbac?: RBACEvaluator;
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
  includeTags: string[];
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
  routerCompatibilityVersion: string;
  organizationId: string;
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

export interface ProtoSubgraph {
  schema: string;
  mappings: string;
  lock: string;
  pluginData?: {
    platforms: string[];
    version: string;
  };
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
  type: DBSubgraphType;
  proto?: ProtoSubgraph;
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

export interface CheckedSubgraphDTO {
  id: string;
  subgraphId?: string;
  subgraphName: string;
  isDeleted: boolean;
  isNew: boolean;
  labels: Label[];
}

export interface LinkedCheckDTO {
  id: string;
  affectedGraphNames: string[];
  subgraphNames: string[];
  namespace: string;
  isCheckSuccessful: boolean;
  hasClientTraffic: boolean;
  hasGraphPruningErrors: boolean;
  clientTrafficCheckSkipped: boolean;
  graphPruningCheckSkipped: boolean;
  isForcedSuccess: boolean;
}

export interface SchemaCheckDTO {
  id: string;
  targetID?: string;
  subgraphName?: string;
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
  hasGraphPruningErrors: boolean;
  clientTrafficCheckSkipped: boolean;
  lintSkipped: boolean;
  graphPruningSkipped: boolean;
  vcsContext?: {
    author: string;
    commitSha: string;
    branch: string;
  };
  checkedSubgraphs: CheckedSubgraphDTO[];
  proposalMatch?: ProposalMatch;
  compositionSkipped: boolean;
  breakingChangesSkipped: boolean;
  errorMessage?: string;
  linkedChecks: LinkedCheckDTO[];
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
    subgraphName?: string;
  }[];
  compositionErrors: string[];
  compositionWarnings: string[];
}

export interface OrganizationDTO {
  id: string;
  name: string;
  slug: string;
  creatorUserId?: string;
  createdAt: string;
  features?: Feature[];
  rbac: RBACEvaluator;
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
  deletion?: {
    queuedAt: string;
    queuedBy?: string;
  };
  kcGroupId: string | undefined;
}

export interface UserDTO {
  id: string;
  email: string;
}

export interface OrganizationGroupDTO {
  groupId: string;
  name: string;
  description: string;
  builtin: boolean;
  kcGroupId: string | null;
  membersCount: number;
  apiKeysCount: number;
  rules: {
    role: OrganizationRole;
    namespaces: string[];
    resources: string[];
  }[];
}

export interface OrganizationMemberDTO {
  userID: string;
  orgMemberID: string;
  email: string;
  rbac: RBACEvaluator;
  active: boolean;
  joinedAt: string;
}

export interface OrganizationInvitationDTO {
  userID: string;
  email: string;
  invitedBy?: string;
  groups: { groupId: string; kcGroupId: string | null }[];
}

export interface APIKeyDTO {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  createdBy: string;
  group: { id: string; name: string } | undefined;
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
  DIRECTIVE_USAGE_UNION_MEMBER_ADDED = 'DIRECTIVE_USAGE_UNION_MEMBER_ADDED',
  DIRECTIVE_USAGE_UNION_MEMBER_REMOVED = 'DIRECTIVE_USAGE_UNION_MEMBER_REMOVED',
  DIRECTIVE_USAGE_ENUM_ADDED = 'DIRECTIVE_USAGE_ENUM_ADDED',
  DIRECTIVE_USAGE_ENUM_REMOVED = 'DIRECTIVE_USAGE_ENUM_REMOVED',
  DIRECTIVE_USAGE_ENUM_VALUE_ADDED = 'DIRECTIVE_USAGE_ENUM_VALUE_ADDED',
  DIRECTIVE_USAGE_ENUM_VALUE_REMOVED = 'DIRECTIVE_USAGE_ENUM_VALUE_REMOVED',
  DIRECTIVE_USAGE_INPUT_OBJECT_ADDED = 'DIRECTIVE_USAGE_INPUT_OBJECT_ADDED',
  DIRECTIVE_USAGE_INPUT_OBJECT_REMOVED = 'DIRECTIVE_USAGE_INPUT_OBJECT_REMOVED',
  DIRECTIVE_USAGE_FIELD_ADDED = 'DIRECTIVE_USAGE_FIELD_ADDED',
  DIRECTIVE_USAGE_FIELD_REMOVED = 'DIRECTIVE_USAGE_FIELD_REMOVED',
  DIRECTIVE_USAGE_SCALAR_ADDED = 'DIRECTIVE_USAGE_SCALAR_ADDED',
  DIRECTIVE_USAGE_SCALAR_REMOVED = 'DIRECTIVE_USAGE_SCALAR_REMOVED',
  DIRECTIVE_USAGE_OBJECT_ADDED = 'DIRECTIVE_USAGE_OBJECT_ADDED',
  DIRECTIVE_USAGE_OBJECT_REMOVED = 'DIRECTIVE_USAGE_OBJECT_REMOVED',
  DIRECTIVE_USAGE_INTERFACE_ADDED = 'DIRECTIVE_USAGE_INTERFACE_ADDED',
  DIRECTIVE_USAGE_INTERFACE_REMOVED = 'DIRECTIVE_USAGE_INTERFACE_REMOVED',
  DIRECTIVE_USAGE_ARGUMENT_DEFINITION_ADDED = 'DIRECTIVE_USAGE_ARGUMENT_DEFINITION_ADDED',
  DIRECTIVE_USAGE_ARGUMENT_DEFINITION_REMOVED = 'DIRECTIVE_USAGE_ARGUMENT_DEFINITION_REMOVED',
  DIRECTIVE_USAGE_SCHEMA_ADDED = 'DIRECTIVE_USAGE_SCHEMA_ADDED',
  DIRECTIVE_USAGE_SCHEMA_REMOVED = 'DIRECTIVE_USAGE_SCHEMA_REMOVED',
  DIRECTIVE_USAGE_FIELD_DEFINITION_ADDED = 'DIRECTIVE_USAGE_FIELD_DEFINITION_ADDED',
  DIRECTIVE_USAGE_FIELD_DEFINITION_REMOVED = 'DIRECTIVE_USAGE_FIELD_DEFINITION_REMOVED',
  DIRECTIVE_USAGE_INPUT_FIELD_DEFINITION_ADDED = 'DIRECTIVE_USAGE_INPUT_FIELD_DEFINITION_ADDED',
  DIRECTIVE_USAGE_INPUT_FIELD_DEFINITION_REMOVED = 'DIRECTIVE_USAGE_INPUT_FIELD_DEFINITION_REMOVED',
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
  given_name?: string;
  family_name?: string;
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
  organizationDeactivated: boolean;
  userId: string;
  rbac: RBACEvaluator;
  userDisplayName: string;
  apiKeyName?: string;
};

export interface GraphApiKeyJwtPayload extends JWTPayload {
  federated_graph_id: string;
  organization_id: string;
}

export interface PluginAccess {
  type: 'repository';
  name: string;
  tag: string;
  actions: string[];
}

export interface PluginApiKeyJwtPayload extends JWTPayload {
  access: PluginAccess[];
}

export interface GraphApiKeyDTO {
  id: string;
  name: string;
  token: string;
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

export interface PersistedOperationWithClientDTO {
  id: string;
  operationId: string;
  hash: string;
  filePath: string;
  createdAt: string;
  createdBy?: string;
  lastUpdatedAt: string;
  lastUpdatedBy: string;
  clientName: string;
  contents: string;
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
  compositionWarnings?: string;
  routerConfigSignature?: string;
  isComposable: boolean;
  isLatestValid: boolean;
  admissionError?: string;
  deploymentError?: string;
  routerCompatibilityVersion: string;
}

export interface FeatureFlagCompositionDTO {
  id: string;
  schemaVersionId: string;
  createdAt: string;
  featureFlagName: string;
  createdBy?: string;
  compositionErrors?: string;
  compositionWarnings?: string;
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
export type RuleLevelAndOptions<Options extends any[] = any[]> = [RuleLevel, ...Partial<Options>];
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

type GraphPruningRuleType = Record<GraphPruningRuleEnum, GraphPruningRuleEnum>;

export const GraphPruningRules: GraphPruningRuleType = {
  UNUSED_FIELDS: 'UNUSED_FIELDS',
  DEPRECATED_FIELDS: 'DEPRECATED_FIELDS',
  REQUIRE_DEPRECATION_BEFORE_DELETION: 'REQUIRE_DEPRECATION_BEFORE_DELETION',
};

export interface SchemaGraphPruningDTO {
  severity: LintSeverityLevel;
  ruleName: GraphPruningRuleEnum;
  gracePeriodInDays: number;
  schemaUsageCheckPeriodInDays?: number;
}

export interface GraphPruningIssueResult {
  graphPruningRuleType: GraphPruningRuleEnum;
  severity: LintSeverity;
  fieldPath: string;
  message: string;
  issueLocation: {
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
  };
  federatedGraphId: string;
  federatedGraphName: string;
  subgraphName?: string;
}

export interface SchemaGraphPruningIssues {
  warnings: GraphPruningIssueResult[];
  errors: GraphPruningIssueResult[];
}

export interface Field {
  name: string;
  typeName: string;
  path: string;
  location: {
    line?: number;
    column?: number;
    endLine?: number;
    endColumn?: number;
  };
  isDeprecated: boolean;
}
export interface S3StorageOptions {
  url: string;
  region?: string;
  endpoint?: string;
  username?: string;
  password?: string;
  forcePathStyle?: boolean;
}

export interface NamespaceDTO {
  id: string;
  name: string;
  createdBy?: string;
  organizationId: string;
  enableLinting: boolean;
  enableGraphPruning: boolean;
  enableCacheWarmer: boolean;
  checksTimeframeInDays?: number;
  enableProposals: boolean;
}

export interface ProposalDTO {
  id: string;
  name: string;
  federatedGraphId: string;
  createdAt: string;
  createdById: string;
  createdByEmail?: string;
  state: string;
}

export interface ProposalSubgraphDTO {
  id: string;
  subgraphName: string;
  subgraphId?: string;
  schemaSDL: string;
  isDeleted: boolean;
  currentSchemaVersionId?: string;
  isNew: boolean;
  labels: Label[];
}

export type CompositionOptions = {
  disableResolvabilityValidation: boolean;
};
