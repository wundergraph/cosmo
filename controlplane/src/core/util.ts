import { randomFill } from 'node:crypto';
import { S3ClientConfig } from '@aws-sdk/client-s3';
import { HandlerContext } from '@connectrpc/connect';
import {
  GraphQLSubscriptionProtocol,
  GraphQLWebsocketSubprotocol,
} from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel, splitLabel } from '@wundergraph/cosmo-shared';
import { AxiosError } from 'axios';
import { isNetworkError, isRetryableError } from 'axios-retry';
import { formatISO, subHours } from 'date-fns';
import { FastifyBaseLogger } from 'fastify';
import { parse, visit } from 'graphql';
import { uid } from 'uid/secure';
import {
  ContractTagOptions,
  FederationResult,
  FederationResultWithContracts,
  LATEST_ROUTER_COMPATIBILITY_VERSION,
  newContractTagOptionsFromArrays,
} from '@wundergraph/composition';
import { SubgraphType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { MemberRole, WebsocketSubprotocol } from '../db/models.js';
import {
  AuthContext,
  CompositionOptions,
  DateRange,
  FederatedGraphDTO,
  Label,
  ResponseMessage,
  S3StorageOptions,
} from '../types/index.js';
import { isAuthenticationError, isAuthorizationError, isPublicError } from './errors/errors.js';
import { GraphKeyAuthContext } from './services/GraphApiTokenAuthenticator.js';
import { composeFederatedContract, composeFederatedGraphWithPotentialContracts } from './composition/composition.js';
import { SubgraphsToCompose } from './repositories/FeatureFlagRepository.js';

const labelRegex = /^[\dA-Za-z](?:[\w.-]{0,61}[\dA-Za-z])?$/;
const organizationSlugRegex = /^[\da-z]+(?:-[\da-z]+)*$/;
const namespaceRegex = /^[\da-z]+(?:[_-][\da-z]+)*$/;
const schemaTagRegex = /^(?![/-])[\d/A-Za-z-]+(?<![/-])$/;
const graphNameRegex = /^[\dA-Za-z]+(?:[./@_-][\dA-Za-z]+)*$/;
const pluginVersionRegex = /^v\d+$/;

/**
 * Wraps a function with a try/catch block and logs any errors that occur.
 * If the error is a public error, it is returned as a response message.
 * Otherwise, the error is rethrown so that it can be handled by the connect framework.
 */
export async function handleError<T extends ResponseMessage>(
  ctx: HandlerContext,
  defaultLogger: FastifyBaseLogger,
  fn: () => Promise<T> | T,
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    // Get enriched logger here. Enriching logger happens within the above function call.
    const logger = getLogger(ctx, defaultLogger);

    if (isAuthenticationError(error)) {
      return {
        response: {
          code: error.code,
          details: error.message,
        },
      } as T;
    } else if (isPublicError(error)) {
      return {
        response: {
          code: error.code,
          details: error.message,
        },
      } as T;
    } else if (isAuthorizationError(error)) {
      return {
        response: {
          code: error.code,
          details: error.message,
        },
      } as T;
    }

    logger.error(error);

    throw error;
  }
}

export const fastifyLoggerId = Symbol('logger');

export const getLogger = (ctx: HandlerContext, defaultLogger: FastifyBaseLogger) => {
  return ctx.values.get<FastifyBaseLogger>({ id: fastifyLoggerId, defaultValue: defaultLogger });
};

export const enrichLogger = (
  ctx: HandlerContext,
  logger: FastifyBaseLogger,
  authContext: Partial<AuthContext & GraphKeyAuthContext>,
) => {
  const newLogger = logger.child({
    service: ctx.service.typeName,
    method: ctx.method.name,
    actor: {
      userId: authContext.userId,
      organizationId: authContext.organizationId,
    },
  });

  ctx.values.set<FastifyBaseLogger>({ id: fastifyLoggerId, defaultValue: newLogger }, newLogger);

  return newLogger;
};

export function createRandomInternalLabel(): Label {
  return {
    key: '_internal',
    value: uid(6),
  };
}

/**
 * Normalizes labels by removing duplicates.
 * Also performs a simple sort
 */
export function normalizeLabels(labels: Label[]): Label[] {
  const concatenatedLabels = labels.map((l) => joinLabel(l)).sort();

  const uniqueLabels = new Set(concatenatedLabels);

  return [...uniqueLabels].map((label) => splitLabel(label));
}

export function isValidSchemaTag(tag: string): boolean {
  if (!tag) {
    return false;
  }

  if (tag.length > 128) {
    return false;
  }

  if (!schemaTagRegex.test(tag)) {
    return false;
  }

  return true;
}

export function isValidSchemaTags(tags: string[]): boolean {
  for (const tag of tags) {
    if (!isValidSchemaTag(tag)) {
      return false;
    }
  }

  return true;
}

/**
 * Both key and value must be 63 characters or fewer (cannot be empty).
 * Must begin and end with an alphanumeric character ([a-z0-9A-Z]).
 * Could contain dashes (-), underscores (_), dots (.), and alphanumerics between.
 */
export function isValidLabels(labels: Label[]): boolean {
  for (const label of labels) {
    const { key, value } = label;

    // key and value cannot be empty
    if (!key || !value) {
      return false;
    }

    // key and value must follow a specific pattern
    if (!labelRegex.test(key) || !labelRegex.test(value)) {
      return false;
    }
  }

  return true;
}

export function isValidLabelMatchers(labelMatchers: string[]): boolean {
  for (const lm of labelMatchers) {
    const labels = lm.split(',').map((l) => splitLabel(l));
    if (!isValidLabels(labels)) {
      return false;
    }
  }

  return true;
}

export function normalizeLabelMatchers(labelMatchers: string[]): string[] {
  const normalizedMatchers: string[] = [];

  for (const lm of labelMatchers) {
    const labels = lm.split(',').map((l) => splitLabel(l));
    const normalizedLabels = normalizeLabels(labels);
    normalizedMatchers.push(normalizedLabels.map((nl) => joinLabel(nl)).join(','));
  }

  // We previously deduplicate and sort the labels. Now we deduplicate the matchers.
  return [...new Set(normalizedMatchers)];
}

export function base64URLEncode(str: Buffer) {
  return str.toString('base64url');
}

export function randomToken() {
  return uid(32);
}

export function randomString(length: number): Promise<string> {
  const buf = Buffer.alloc(length);

  return new Promise((resolve, reject) => {
    randomFill(buf, (err, buf) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(base64URLEncode(buf));
    });
  });
}

export function sanitizeMigratedGraphName(input: string): string {
  if (labelRegex.test(input)) {
    return input;
  }
  return `migrated_graph_${uid(12)}`;
}

export const formatSubscriptionProtocol = (protocol: GraphQLSubscriptionProtocol) => {
  switch (protocol) {
    case GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_WS: {
      return 'ws';
    }
    case GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE: {
      return 'sse';
    }
    case GraphQLSubscriptionProtocol.GRAPHQL_SUBSCRIPTION_PROTOCOL_SSE_POST: {
      return 'sse_post';
    }
  }
};

export const formatWebsocketSubprotocol = (protocol: GraphQLWebsocketSubprotocol): WebsocketSubprotocol => {
  switch (protocol) {
    case GraphQLWebsocketSubprotocol.GRAPHQL_WEBSOCKET_SUBPROTOCOL_AUTO: {
      return 'auto';
    }
    case GraphQLWebsocketSubprotocol.GRAPHQL_WEBSOCKET_SUBPROTOCOL_WS: {
      return 'graphql-ws';
    }
    case GraphQLWebsocketSubprotocol.GRAPHQL_WEBSOCKET_SUBPROTOCOL_TRANSPORT_WS: {
      return 'graphql-transport-ws';
    }
  }
};

export const hasLabelsChanged = (prev: Label[], cur: Label[]): boolean => {
  if (prev.length !== cur.length) {
    return true;
  }

  // This works fine because we don't allow comma in the label key or value,
  // so we can use it as a separator to compare the labels
  return (
    prev
      .map((p) => joinLabel(p))
      .sort()
      .join(',') !==
    cur
      .map((c) => joinLabel(c))
      .sort()
      .join(',')
  );
};

// checks if the user has the right roles to perform the operation.
export const checkUserAccess = ({ rolesToBe, userRoles }: { rolesToBe: MemberRole[]; userRoles: MemberRole[] }) => {
  for (const role of rolesToBe) {
    if (userRoles.includes(role)) {
      return true;
    }
  }
  return false;
};

export const getHighestPriorityRole = ({ userRoles }: { userRoles: string[] }) => {
  if (userRoles.includes('admin')) {
    return 'admin';
  }
  if (userRoles.includes('developer')) {
    return 'developer';
  }
  return 'viewer';
};

export const isValidNamespaceName = (name: string): boolean => {
  return namespaceRegex.test(name);
};

export const isValidGraphName = (name: string): boolean => {
  if (name.length === 0 || name.length > 100) {
    return false;
  }
  return graphNameRegex.test(name);
};

export const isValidOrganizationSlug = (slug: string): boolean => {
  // these reserved slugs are the root paths of the studio,
  // so the org slug should not be the same as one of our root paths
  const reservedSlugs = ['login', 'signup', 'create', 'account'];

  if (slug.length < 3 || slug.length > 24) {
    return false;
  }

  if (!organizationSlugRegex.test(slug)) {
    return false;
  }

  if (reservedSlugs.includes(slug)) {
    return false;
  }

  return true;
};

export const isValidOrganizationName = (name: string): boolean => {
  if (name.length === 0 || name.length > 24) {
    return false;
  }

  return true;
};

export const isValidPluginVersion = (version: string): boolean => {
  return pluginVersionRegex.test(version);
};

export const validateDateRanges = ({
  limit,
  range,
  dateRange,
}: {
  limit: number;
  range?: number;
  dateRange?: DateRange;
}): { range: number | undefined; dateRange: DateRange | undefined } => {
  let validatedRange: number | undefined = range;
  const validatedDateRange: DateRange | undefined = dateRange;

  if (validatedRange && validatedRange > limit * 24) {
    validatedRange = limit * 24;
  }

  if (validatedDateRange) {
    const startDate = new Date(validatedDateRange.start);
    if (startDate < subHours(new Date(), limit * 24)) {
      validatedDateRange.start = formatISO(subHours(new Date(), limit * 24));
    }
  }

  return {
    range: validatedRange,
    dateRange: validatedDateRange,
  };
};

export const extractOperationNames = (contents: string): string[] => {
  // parse contents using graphql library and extract operation names
  // return operation names
  const names: string[] = [];
  const doc = parse(contents);
  visit(doc, {
    OperationDefinition(node) {
      const operationName = node.name?.value ?? '';
      if (operationName) {
        names.push(operationName);
      }
    },
  });
  return names;
};

export function getValueOrDefault<K, V>(map: Map<K, V>, key: K, constructor: () => V): V {
  const existingValue = map.get(key);
  if (existingValue) {
    return existingValue;
  }
  const value = constructor();
  map.set(key, value);
  return value;
}

// webhookAxiosRetryCond retry condition function to retry on network errors and 429, 5xx errors for all
// HTTP methods including POST, PUT, DELETE, etc.
export function webhookAxiosRetryCond(err: AxiosError) {
  return isNetworkError(err) || isRetryableError(err);
}

/**
 * Determines whether the given string is a Google Cloud Storage address by checking whether the hostname is
 * `storage.googleapis.com` or the protocol is `gs:`.
 */
export function isGoogleCloudStorageUrl(s: string): boolean {
  if (!s) {
    return false;
  }

  try {
    const url = new URL(s);
    const hostname = url.hostname.toLowerCase();

    return (
      url.protocol === 'gs:' || hostname === 'storage.googleapis.com' || hostname.endsWith('.storage.googleapis.com')
    );
  } catch {
    // ignore
  }

  return false;
}

export function createS3ClientConfig(bucketName: string, opts: S3StorageOptions): S3ClientConfig {
  const url = new URL(opts.url);
  const { region, username, password } = opts;
  const forcePathStyle = opts.forcePathStyle ?? !isVirtualHostStyleUrl(url);
  const endpoint = opts.endpoint || (forcePathStyle ? url.origin : url.origin.replace(`${bucketName}.`, ''));

  const accessKeyId = url.username || username || '';
  const secretAccessKey = url.password || password || '';

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing S3 credentials. Please provide access key ID and secret access key.');
  }

  if (!region) {
    throw new Error('Missing region in S3 configuration.');
  }

  return {
    region,
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle,
  };
}

export function extractS3BucketName(opts: S3StorageOptions) {
  const url = new URL(opts.url);

  if (opts.forcePathStyle || !isVirtualHostStyleUrl(url)) {
    return url.pathname.slice(1);
  }

  return url.hostname.split('.')[0];
}

export function isVirtualHostStyleUrl(url: URL) {
  return url.hostname.split('.').length > 2;
}

export function mergeUrls(baseUrl: string, relativeUrl: string) {
  // Remove the leading slash beacuse if the relative URL starts with a slash,
  // the relative part will merge with only the hostname ignoring the rest of the base url if any.
  relativeUrl = relativeUrl.startsWith('/') ? relativeUrl.slice(1) : relativeUrl;

  // Same as the above case, if the base URL doesnt end with a slash,
  // the computed url will only have the host and the relative URL and will ignore the rest of the base URL if any.
  baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';

  return new URL(relativeUrl, baseUrl).toString();
}

export function createBatches<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < array.length; i += batchSize) {
    const batch = array.slice(i, i + batchSize);
    batches.push(batch);
  }

  return batches;
}

export const checkIfLabelMatchersChanged = (data: {
  isContract: boolean;
  currentLabelMatchers: string[];
  newLabelMatchers: string[];
  unsetLabelMatchers?: boolean;
}) => {
  if (data.isContract && data.newLabelMatchers.length === 0) {
    return false;
  }

  // User tries to unset but no matchers exist, then nothing has changed
  if (data.unsetLabelMatchers && data.currentLabelMatchers.length === 0) {
    return false;
  }

  // If user tries to unset but matchers exist, then it has changed
  if (data.unsetLabelMatchers) {
    return true;
  }

  // Not a contract, not unsetting, no new matchers, then nothing has changed
  if (data.newLabelMatchers.length === 0) {
    return false;
  }

  // Not a contract, not unsetting but new matchers are passed, we need to check if they are different
  if (data.newLabelMatchers.length !== data.currentLabelMatchers.length) {
    return true;
  }

  for (const labelMatcher of data.newLabelMatchers) {
    if (!data.currentLabelMatchers.includes(labelMatcher)) {
      return true;
    }
  }

  return false;
};

export function getFederationResultWithPotentialContracts(
  federatedGraph: FederatedGraphDTO,
  subgraphsToCompose: SubgraphsToCompose,
  tagOptionsByContractName: Map<string, ContractTagOptions>,
  compositionOptions?: CompositionOptions,
): FederationResult | FederationResultWithContracts {
  // This condition is only true when entering the method to specifically create/update a contract
  if (federatedGraph.contract) {
    return composeFederatedContract(
      subgraphsToCompose.compositionSubgraphs,
      newContractTagOptionsFromArrays(federatedGraph.contract.excludeTags, federatedGraph.contract.includeTags),
      federatedGraph.routerCompatibilityVersion,
      compositionOptions,
    );
  }
  return composeFederatedGraphWithPotentialContracts(
    subgraphsToCompose.compositionSubgraphs,
    tagOptionsByContractName,
    federatedGraph.routerCompatibilityVersion,
    compositionOptions,
  );
}

export function getFederatedGraphRouterCompatibilityVersion(federatedGraphDTOs: Array<FederatedGraphDTO>): string {
  if (federatedGraphDTOs.length === 0) {
    return LATEST_ROUTER_COMPATIBILITY_VERSION;
  }
  return federatedGraphDTOs[0].routerCompatibilityVersion;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const isCheckSuccessful = ({
  isComposable,
  isBreaking,
  hasClientTraffic,
  hasLintErrors,
  hasGraphPruningErrors,
  clientTrafficCheckSkipped,
  hasProposalMatchError,
  isLinkedTrafficCheckFailed,
  isLinkedPruningCheckFailed,
}: {
  isComposable: boolean;
  isBreaking: boolean;
  hasClientTraffic: boolean;
  hasLintErrors: boolean;
  hasGraphPruningErrors: boolean;
  clientTrafficCheckSkipped: boolean;
  hasProposalMatchError: boolean;
  isLinkedTrafficCheckFailed?: boolean;
  isLinkedPruningCheckFailed?: boolean;
}) => {
  // if a subgraph is linked to another subgraph, then the status of the check depends on the traffic and pruning check of the linked subgraph
  if (isLinkedTrafficCheckFailed || isLinkedPruningCheckFailed) {
    return false;
  }

  return (
    isComposable &&
    // If no breaking changes found
    // OR Breaking changes are found, but no client traffic is found and traffic check is not skipped
    (!isBreaking || (isBreaking && !hasClientTraffic && !clientTrafficCheckSkipped)) &&
    !hasLintErrors &&
    !hasGraphPruningErrors &&
    !hasProposalMatchError
  );
};

export const flipDateRangeValuesIfNeeded = (dateRange?: { start: number; end: number }) => {
  if (!dateRange || dateRange.start <= dateRange.end) {
    return;
  }

  const tmp = dateRange.start;
  dateRange.start = dateRange.end;
  dateRange.end = tmp;
};

export const formatSubgraphType = (type: SubgraphType) => {
  switch (type) {
    case SubgraphType.STANDARD: {
      return 'standard';
    }
    case SubgraphType.GRPC_PLUGIN: {
      return 'grpc_plugin';
    }
    case SubgraphType.GRPC_SERVICE: {
      return 'grpc_service';
    }
    default: {
      throw new Error(`Unknown subgraph type: ${type}`);
    }
  }
};

export const convertToSubgraphType = (type: string) => {
  switch (type) {
    case 'standard': {
      return SubgraphType.STANDARD;
    }
    case 'grpc_plugin': {
      return SubgraphType.GRPC_PLUGIN;
    }
    case 'grpc_service': {
      return SubgraphType.GRPC_SERVICE;
    }
    default: {
      throw new Error(`Unknown subgraph type: ${type}`);
    }
  }
};

export function newCompositionOptions(disableResolvabilityValidation?: boolean): CompositionOptions | undefined {
  if (!disableResolvabilityValidation) {
    return;
  }
  return {
    disableResolvabilityValidation,
  };
}
