import { randomFill } from 'node:crypto';
import pino from 'pino';
import { joinLabel, splitLabel } from '@wundergraph/cosmo-shared';
import { uid } from 'uid/secure';
import { Label, ResponseMessage } from '../types/index.js';
import { isAuthenticationError, isPublicError } from './errors/errors.js';

const labelRegex = /^[\dA-Za-z](?:[\w.-]{0,61}[\dA-Za-z])?$/;

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
    logger.error(error);

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
    }

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

function isValidLabel(value: string): boolean {
  return labelRegex.test(value);
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
  if (isValidLabel(input)) {
    return input;
  }
  return `migrated_graph_${uid(12)}`;
}