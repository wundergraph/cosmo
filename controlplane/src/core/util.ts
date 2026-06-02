import { randomFill } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { S3ClientConfig } from '@aws-sdk/client-s3';
import { Code, ConnectError, HandlerContext } from '@connectrpc/connect';
import * as Sentry from '@sentry/node';
import {
  GraphQLSubscriptionProtocol,
  GraphQLWebsocketSubprotocol,
} from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel, splitLabel } from '@wundergraph/cosmo-shared';
import { AxiosError } from 'axios';
import { isNetworkError, isRetryableError } from 'axios-retry';
import { formatISO, subHours } from 'date-fns';
import { inArray, SQL } from 'drizzle-orm';
import { PgColumn } from 'drizzle-orm/pg-core';
import { FastifyBaseLogger } from 'fastify';
import { parse, visit } from 'graphql';
import { uid } from 'uid/secure';
import DOMPurify from 'isomorphic-dompurify';
import { LATEST_ROUTER_COMPATIBILITY_VERSION } from '@wundergraph/composition';
import { ProposalOrigin, SubgraphType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { MemberRole, ProposalOrigin as ProposalOriginEnum, WebsocketSubprotocol } from '../db/models.js';
import {
  AuthContext,
  DateRange,
  FederatedGraphDTO,
  Label,
  LoginMethod,
  NamespaceAccess,
  ResponseMessage,
  S3StorageOptions,
  SOCIAL_LOGIN_PROVIDERS,
  SocialLoginProvider,
} from '../types/index.js';
import { paginationDefaults } from './constants.js';
import {
  isAuthenticationError,
  isAuthorizationError,
  isClickHouseUnavailableError,
  isPublicError,
  LoginMethodNotAllowedError,
} from './errors/errors.js';
import { GraphKeyAuthContext } from './services/GraphApiTokenAuthenticator.js';
import { RBACEvaluator } from './services/RBACEvaluator.js';
import type { OidcRepository } from './repositories/OidcRepository.js';
import type { OrganizationRepository } from './repositories/OrganizationRepository.js';
import type { NamespaceLoginMethodRepository } from './repositories/NamespaceLoginMethodRepository.js';
import type { OrganizationLoginMethodRepository } from './repositories/OrganizationLoginMethodRepository.js';

const labelRegex = /^[\dA-Za-z](?:[\w.-]{0,61}[\dA-Za-z])?$/;
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
    } else if (isClickHouseUnavailableError(error)) {
      logger.error(error);
      throw new ConnectError(error.message, Code.Unavailable);
    }

    logger.error(error);

    throw error;
  }
}

export const fastifyLoggerId = Symbol('logger');
export const sentrySpanId = Symbol('sentrySpan');

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

  Sentry.setUser({
    id: authContext.userId,
    username: authContext.userDisplayName,
  });

  const spanAttributes = Object.fromEntries(
    Object.entries({
      'user.id': authContext.userId,
      'user.displayName': authContext.userDisplayName,
      'organization.id': authContext.organizationId,
      'organization.slug': authContext.organizationSlug,
    }).filter(([, v]) => v),
  );

  const activeSpan = Sentry.getActiveSpan();
  if (activeSpan) {
    Sentry.getRootSpan(activeSpan).setAttributes(spanAttributes);
  }

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
    const endDate = new Date(validatedDateRange.end);
    if (startDate > endDate || endDate < subHours(new Date(), limit * 24)) {
      return {
        range: validatedRange,
        dateRange: undefined,
      };
    }
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

/**
 * Distributes a limit across multiple arrays that are logically grouped.
 * Arrays are processed in order, with earlier arrays having priority.
 *
 * Example: limitCombinedArrays([errors, warnings], 50)
 * - If errors has 70 items and warnings has 10 items: returns [50 errors, 0 warnings]
 * - If errors has 30 items and warnings has 30 items: returns [30 errors, 20 warnings]
 * - If errors has 10 items and warnings has 70 items: returns [10 errors, 40 warnings]
 *
 * @param arrays The arrays to limit (order determines priority)
 * @param limit The combined maximum number of items across all arrays
 * @returns The limited arrays in the same order as input
 */
export function limitCombinedArrays<T>(arrays: T[][], limit: number | null): T[][] {
  if (arrays.length === 0) {
    return [];
  }

  if (limit == null) {
    return arrays;
  }

  const result: T[][] = [];
  let remaining = limit;

  // Process arrays in order, taking as much as possible from each
  for (const arr of arrays) {
    if (remaining === 0) {
      result.push([]);
    } else {
      const itemsToTake = Math.min(arr.length, remaining);
      result.push(arr.slice(0, itemsToTake));
      remaining -= itemsToTake;
    }
  }

  return result;
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

export function getFederatedGraphRouterCompatibilityVersion(federatedGraphDTOs: Array<FederatedGraphDTO>): string {
  if (federatedGraphDTOs.length === 0) {
    return LATEST_ROUTER_COMPATIBILITY_VERSION;
  }
  return federatedGraphDTOs[0].routerCompatibilityVersion;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Normalizes pagination parameters by applying defaults and clamping to safe bounds.
 * Uses the standard pagination defaults from constants unless overridden.
 */
export function normalizePagination(
  opts: { limit?: number; offset?: number },
  overrides?: { maxLimit?: number; maxOffset?: number },
): { limit: number; offset: number } {
  const maxLimit = overrides?.maxLimit ?? paginationDefaults.maxLimit;
  const maxOffset = overrides?.maxOffset ?? paginationDefaults.maxOffset;

  return {
    limit: clamp(opts.limit || paginationDefaults.defaultLimit, paginationDefaults.minLimit, maxLimit),
    offset: clamp(opts.offset || 0, paginationDefaults.minOffset, maxOffset),
  };
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
  checkExtensionDeliveryId,
  checkExtensionErrorMessage,
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
  checkExtensionDeliveryId?: string;
  checkExtensionErrorMessage?: string;
}) => {
  // if a subgraph is linked to another subgraph, then the status of the check depends on the traffic and pruning check of the linked subgraph
  if (isLinkedTrafficCheckFailed || isLinkedPruningCheckFailed) {
    return false;
  }

  if (checkExtensionDeliveryId && checkExtensionErrorMessage) {
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

export function toProposalOriginEnum(value: ProposalOrigin): ProposalOriginEnum {
  switch (value) {
    case ProposalOrigin.EXTERNAL: {
      return 'EXTERNAL';
    }
    default: {
      return 'INTERNAL';
    }
  }
}

export function fromProposalOriginEnum(value: ProposalOriginEnum): ProposalOrigin {
  switch (value) {
    case 'EXTERNAL': {
      return ProposalOrigin.EXTERNAL;
    }
    default: {
      return ProposalOrigin.INTERNAL;
    }
  }
}

export function sanitizeReadme(value: string | undefined | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length === 0 ? null : DOMPurify.sanitize(trimmedValue);
}

export function isValidLocalhostOrSecureEndpoint(value: string) {
  if (!value) {
    return false;
  }

  let isValid = false;
  try {
    const endpoint = new URL(value);
    isValid =
      (endpoint.hostname === 'localhost' && (endpoint.protocol === 'http:' || endpoint.protocol === 'https:')) ||
      (endpoint.hostname !== 'localhost' && endpoint.protocol === 'https:');
  } catch {
    // ignore
  }

  return isValid;
}

function isValidPort(port: string | undefined): boolean {
  if (port === undefined) {
    return true;
  }
  if (!/^\d+$/.test(port)) {
    return false;
  }
  const portNum = Number.parseInt(port, 10);
  // Valid port range is 1-65535 (port 0 is reserved)
  return portNum >= 1 && portNum <= 65_535;
}

function isValidHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253) {
    return false;
  }
  const labels = hostname.split('.');
  return labels.every((label) => /^[\da-z](?:[\da-z-]{0,61}[\da-z])?$/i.test(label));
}

function isValidHostOrIpv4(host: string): boolean {
  return isIPv4(host) || isValidHostname(host);
}

function isValidHostPort(target: string): boolean {
  if (!target || target.includes('/')) {
    return false;
  }
  const lastColonIndex = target.lastIndexOf(':');
  if (lastColonIndex === -1) {
    return isValidHostOrIpv4(target);
  }
  if (target.indexOf(':') !== lastColonIndex) {
    return false;
  }
  const host = target.slice(0, lastColonIndex);
  const port = target.slice(lastColonIndex + 1);
  if (!host || !port) {
    return false;
  }
  return isValidHostOrIpv4(host) && isValidPort(port);
}

function isValidDnsTarget(rest: string): boolean {
  if (!rest) {
    return false;
  }
  if (rest.startsWith('//')) {
    const remainder = rest.slice(2);
    if (!remainder) {
      return false;
    }
    const slashIndex = remainder.indexOf('/');
    const endpoint = slashIndex === -1 ? remainder : remainder.slice(slashIndex + 1);
    return isValidHostPort(endpoint);
  }
  return isValidHostPort(rest);
}

/**
 * Validates if a routing URL is using one of the supported gRPC naming schemes.
 * Supported schemes: dns:, unix:, unix-abstract:, vsock:, ipv4:, ipv6:
 */
export function isValidGrpcNamingScheme(url: string): boolean {
  const value = url.trim();
  if (!value) {
    return false;
  }

  const supportedSchemes = new Set(['dns', 'unix', 'unix-abstract', 'vsock', 'ipv4', 'ipv6']);
  const schemeMatch = /^([a-z][\d+.a-z-]*):/i.exec(value);
  if (!schemeMatch) {
    return isValidDnsTarget(value);
  }

  const scheme = schemeMatch[1].toLowerCase();
  const rest = value.slice(schemeMatch[0].length);
  if (!supportedSchemes.has(scheme)) {
    return isValidDnsTarget(value);
  }

  switch (scheme) {
    case 'dns': {
      if (rest.startsWith('//')) {
        const remainder = rest.slice(2);
        const slashIndex = remainder.indexOf('/');
        if (slashIndex === -1) {
          return false; // No host:port path found
        }
        const endpoint = remainder.slice(slashIndex + 1);
        if (!endpoint) {
          return false; // Empty endpoint after slash
        }
        return isValidHostPort(endpoint);
      }
      return isValidDnsTarget(rest);
    }
    case 'unix': {
      if (!rest) {
        return false;
      }
      let path = rest;
      if (rest.startsWith('//')) {
        const remainder = rest.slice(2);
        const slashIndex = remainder.indexOf('/');
        path = slashIndex === -1 ? '' : remainder.slice(slashIndex);
      }
      return path.length > 0 && path !== '/';
    }
    case 'unix-abstract': {
      return rest.length > 0;
    }
    case 'vsock': {
      const parts = rest.split(':');
      if (parts.length !== 2) {
        return false;
      }
      const [cid, port] = parts;
      if (!/^\d+$/.test(cid) || !/^\d+$/.test(port)) {
        return false;
      }
      // Validate port range (1-65535)
      return isValidPort(port);
    }
    case 'ipv4': {
      if (!rest) {
        return false;
      }
      const endpoints = rest.split(',').map((endpoint) => endpoint.trim());
      return endpoints.every((endpoint) => {
        if (!endpoint) {
          return false;
        }
        const lastColonIndex = endpoint.lastIndexOf(':');
        if (lastColonIndex === -1) {
          return isIPv4(endpoint);
        }
        if (endpoint.indexOf(':') !== lastColonIndex) {
          return false;
        }
        const host = endpoint.slice(0, lastColonIndex);
        const port = endpoint.slice(lastColonIndex + 1);
        return isIPv4(host) && isValidPort(port);
      });
    }
    case 'ipv6': {
      if (!rest) {
        return false;
      }
      const endpoints = rest.split(',').map((endpoint) => endpoint.trim());
      return endpoints.every((endpoint) => {
        if (!endpoint) {
          return false;
        }
        if (endpoint.startsWith('[')) {
          const closingIndex = endpoint.indexOf(']');
          if (closingIndex === -1) {
            return false;
          }
          const address = endpoint.slice(1, closingIndex);
          if (!isIPv6(address)) {
            return false;
          }
          const portPart = endpoint.slice(closingIndex + 1);
          if (!portPart) {
            return true;
          }
          if (!portPart.startsWith(':')) {
            return false;
          }
          return isValidPort(portPart.slice(1));
        }
        return isIPv6(endpoint);
      });
    }
    default: {
      return false;
    }
  }
}

/**
 * Applies the IdP namespace gate to a list-query's WHERE conditions, based on
 * the actor's {@link NamespaceAccess}:
 *
 * - `all`        → pushes nothing, returns `true`.
 * - `none`       → returns `false`; the caller must short-circuit with its own
 *                  "no rows" value (`[]`, `0`, `false`, …) instead of querying.
 * - `restricted` → pushes `namespaceColumn IN (...)`, returns `true`.
 *
 * `namespaceColumn` is the namespace-id column of the query's FROM table, which
 * differs per caller (e.g. `targets.namespaceId`, `namespaces.id`,
 * `featureFlags.namespaceId`).
 */
export function applyIdpNamespaceGate(
  rbac: RBACEvaluator | undefined,
  namespaceColumn: PgColumn,
  conditions: (SQL<unknown> | undefined)[],
): boolean {
  const access = rbac?.idpNamespaceAccess ?? { kind: 'all' };
  switch (access.kind) {
    case 'all': {
      return true;
    }
    case 'none': {
      return false;
    }
    case 'restricted': {
      conditions.push(inArray(namespaceColumn, [...access.namespaceIds]));
      return true;
    }
  }
}

/**
 * Resolves the login method from a session's IdP alias, scoped to a specific
 * organization. Returns an `sso` method when the alias matches an org OIDC
 * provider, a `social` method for built-in social brokers, or `password` as
 * the default. Extracted so callers outside of `buildAuthState` (e.g. the
 * `/session` endpoint) can reuse the identical resolution logic.
 */
export async function resolveLoginMethod(
  deps: { oidcRepo: OidcRepository },
  input: { organizationId: string; idpAlias: string | null | undefined },
): Promise<LoginMethod> {
  if (input.idpAlias) {
    const provider = await deps.oidcRepo.getOidcProviderByAlias({
      alias: input.idpAlias,
      organizationId: input.organizationId,
    });
    if (provider) {
      return { type: 'sso', ssoProviderId: provider.id, alias: input.idpAlias };
    }
    if (isSocialLoginProvider(input.idpAlias)) {
      return { type: 'social', provider: input.idpAlias, alias: input.idpAlias };
    }
  }
  return { type: 'password' };
}

/**
 * Derives the full auth state for an interactive (web-session or access-token)
 * login from the session's IdP alias:
 *  1. Resolves the login method — a custom OIDC app when the alias matches an
 *     org provider, otherwise password (no IdP, or an alias whose provider no
 *     longer belongs to the org, so default-open namespaces stay reachable).
 *  2. Applies the IdP namespace gate for that login method.
 *  3. Builds the RBAC evaluator from the org's member groups plus the gate.
 *
 * Returns the login method and the evaluator. The namespace gate is baked into
 * the evaluator (`rbac.idpNamespaceAccess`), which is the single source of
 * truth for it. Shared by both authenticators.
 */
export async function buildAuthState(
  deps: {
    oidcRepo: OidcRepository;
    orgRepo: OrganizationRepository;
    namespaceLoginMethodRepo: NamespaceLoginMethodRepository;
    orgLoginMethodRepo: OrganizationLoginMethodRepository;
  },
  input: { organizationId: string; userId: string; idpAlias: string | null | undefined },
): Promise<{ loginMethod: LoginMethod; rbac: RBACEvaluator }> {
  const loginMethod = await resolveLoginMethod(
    { oidcRepo: deps.oidcRepo },
    { organizationId: input.organizationId, idpAlias: input.idpAlias },
  );

  // Org-level login-method gate: deny the whole org when the method is not allowed.
  const isOrgLoginMethodAllowed = await deps.orgLoginMethodRepo.isLoginMethodAllowed({
    organizationId: input.organizationId,
    loginMethod,
  });
  if (!isOrgLoginMethodAllowed) {
    throw new LoginMethodNotAllowedError();
  }

  const namespaceAccess = await deps.namespaceLoginMethodRepo.allowedNamespaces({
    organizationId: input.organizationId,
    loginMethod,
  });

  const rbac = new RBACEvaluator(
    await deps.orgRepo.getOrganizationMemberGroups({
      organizationID: input.organizationId,
      userID: input.userId,
    }),
    input.userId,
    /* isApiKey */ false,
    namespaceAccess,
  );

  return { loginMethod, rbac };
}

/**
 * Whether an organization allow-list permits the given login method. Used by the
 * org login-method update to verify the acting admin's method stays allowed (the
 * self-lockout guard). API keys cannot be the actor — they are rejected before
 * this is reached — so they are excluded from the parameter type by design.
 */
export function isLoginMethodAllowedToUpdate(
  allow: {
    allowPasswordLogin: boolean;
    allowGoogleLogin: boolean;
    allowGithubLogin: boolean;
    allowedSsoProviderIds: string[];
  },
  method: LoginMethod,
): boolean {
  switch (method.type) {
    case 'sso': {
      return allow.allowedSsoProviderIds.includes(method.ssoProviderId);
    }
    case 'social': {
      return method.provider === 'google' ? allow.allowGoogleLogin : allow.allowGithubLogin;
    }
    case 'password': {
      return allow.allowPasswordLogin;
    }
    case 'api-key': {
      return false;
    }
    default: {
      throw new Error(`Unhandled login method type: ${JSON.stringify(method)}`);
    }
  }
}

/**
 * Whether a single login-method config row (from `organization_login_methods` or
 * `namespace_login_methods`) matches the given login method. Shared by both gates
 * so the matching rule lives in one place. API keys (and any unknown method) do
 * not match a row; callers that exempt API keys must short-circuit before this.
 */
export function loginMethodMatchesRow(
  method: LoginMethod,
  row: {
    ssoProviderId: string | null;
    isPasswordLogin: boolean | null;
    isGoogleLogin: boolean | null;
    isGithubLogin: boolean | null;
  },
): boolean {
  switch (method.type) {
    case 'sso': {
      return row.ssoProviderId === method.ssoProviderId;
    }
    case 'social': {
      return method.provider === 'google' ? !!row.isGoogleLogin : !!row.isGithubLogin;
    }
    case 'password': {
      return !!row.isPasswordLogin;
    }
    default: {
      return false;
    }
  }
}

/**
 * Whether a namespace login-method mapping references any method that the given
 * org allow-list no longer permits. Used to find the namespace mappings an org
 * restriction would have to prune.
 */
export function doesNamespaceMappingExceedsOrgAllowList(
  mapping: {
    allowPasswordLogin: boolean;
    allowGoogleLogin: boolean;
    allowGithubLogin: boolean;
    allowedSsoProviderIds: string[];
  },
  allow: {
    allowPasswordLogin: boolean;
    allowGoogleLogin: boolean;
    allowGithubLogin: boolean;
    allowedSsoProviderIds: string[];
  },
): boolean {
  return (
    (mapping.allowPasswordLogin && !allow.allowPasswordLogin) ||
    (mapping.allowGoogleLogin && !allow.allowGoogleLogin) ||
    (mapping.allowGithubLogin && !allow.allowGithubLogin) ||
    mapping.allowedSsoProviderIds.some((id) => !allow.allowedSsoProviderIds.includes(id))
  );
}

/** Whether a specific namespace is reachable under the given {@link NamespaceAccess}. */
export function isNamespaceAllowed(access: NamespaceAccess, namespaceId: string): boolean {
  switch (access.kind) {
    case 'all': {
      return true;
    }
    case 'none': {
      return false;
    }
    case 'restricted': {
      return access.namespaceIds.has(namespaceId);
    }
  }
}

/** Whether the given IdP alias is one of Keycloak's built-in social brokers. */
export function isSocialLoginProvider(alias: string): alias is SocialLoginProvider {
  return (SOCIAL_LOGIN_PROVIDERS as readonly string[]).includes(alias);
}
