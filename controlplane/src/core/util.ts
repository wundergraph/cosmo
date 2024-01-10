import { randomFill } from 'node:crypto';
import pino from 'pino';
import { joinLabel, splitLabel } from '@wundergraph/cosmo-shared';
import { uid } from 'uid/secure';
import { GraphQLSubscriptionProtocol } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { formatISO, subHours } from 'date-fns';
import { parse, visit } from 'graphql';
import { Label, ResponseMessage, DateRange } from '../types/index.js';
import { MemberRole } from '../db/models.js';
import { isAuthenticationError, isAuthorizationError, isPublicError } from './errors/errors.js';

const labelRegex = /^[\dA-Za-z](?:[\w.-]{0,61}[\dA-Za-z])?$/;
const organizationSlugRegex = /^[\da-z]+(?:-[\da-z]+)*$/;

/**
 * Wraps a function with a try/catch block and logs any errors that occur.
 * If the error is a public error, it is returned as a response message.
 * Otherwise, the error is rethrown so that it can be handled by the connect framework.
 */
export async function handleError<T extends ResponseMessage>(
  logger: pino.BaseLogger,
  fn: () => Promise<T> | T,
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
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
 * Both key and value must be 63 characters or less (cannot be empty).
 * Must begin and end with an alphanumeric character ([a-z0-9A-Z]).
 * Could contain dashes (-), underscores (_), dots (.), and alphanumerics between.
 */
export function isValidLabels(labels: Label[]): boolean {
  for (const label of labels) {
    const { key, value } = label;
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

  return normalizedMatchers;
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

export const isValidOrganizationSlug = (slug: string): boolean => {
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
