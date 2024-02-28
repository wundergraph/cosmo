import { randomFill } from 'node:crypto';
import { HandlerContext } from '@connectrpc/connect';
import { GraphQLSubscriptionProtocol } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel, splitLabel } from '@wundergraph/cosmo-shared';
import { formatISO, subHours } from 'date-fns';
import { FastifyBaseLogger } from 'fastify';
import { parse, visit } from 'graphql';
import { uid } from 'uid/secure';
import { MemberRole } from '../db/models.js';
import { AuthContext, DateRange, Label, ResponseMessage } from '../types/index.js';
import { isAuthenticationError, isAuthorizationError, isPublicError } from './errors/errors.js';
import { GraphKeyAuthContext } from './services/GraphApiTokenAuthenticator.js';

const labelRegex = /^[\dA-Za-z](?:[\w.-]{0,61}[\dA-Za-z])?$/;
const organizationSlugRegex = /^[\da-z]+(?:-[\da-z]+)*$/;
const namespaceRegex = /^[\da-z]+(?:[_-][\da-z]+)*$/;

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

  ctx.values
    .delete({ id: fastifyLoggerId, defaultValue: newLogger })
    .set<FastifyBaseLogger>({ id: fastifyLoggerId, defaultValue: newLogger }, newLogger);

  return newLogger;
};

/**
 * Normalizes labels by removing duplicates.
 * Also performs a simple sort
 */
export function normalizeLabels(labels: Label[]): Label[] {
  const concatenatedLabels = labels.map((l) => joinLabel(l)).sort();

  const uniqueLabels = new Set(concatenatedLabels);

  return [...uniqueLabels].map((label) => splitLabel(label));
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
    if (startDate < subHours(new Date(), limit * 24)) {
      validatedDateRange.start = formatISO(subHours(new Date(), limit * 24));
    }
    if (endDate > new Date()) {
      validatedDateRange.end = formatISO(new Date());
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
