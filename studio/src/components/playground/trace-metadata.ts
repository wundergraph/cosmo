import { getOperationAST, type DocumentNode } from 'graphql';

export type TraceHeader = string | readonly string[];

const normalizeTraceHeader = (value: unknown): TraceHeader | undefined => {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : undefined;
  }
  if (!Array.isArray(value)) {
    return;
  }
  const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return entries.length > 0 ? entries : undefined;
};

export const getTraceHeader = (serializedHeaders: string): TraceHeader | undefined => {
  try {
    const headers = JSON.parse(serializedHeaders || '{}');
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
      return;
    }
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === 'x-wg-trace') {
        const traceHeader = normalizeTraceHeader(value);
        if (traceHeader !== undefined) {
          return traceHeader;
        }
      }
    }
  } catch {
    return;
  }
};

export const traceHeaderIncludes = (serializedHeaders: string, option: string) => {
  const traceHeader = getTraceHeader(serializedHeaders);
  const expected = option.toLowerCase();
  return typeof traceHeader === 'string'
    ? traceHeader.toLowerCase().includes(expected)
    : traceHeader?.some((entry) => entry.toLowerCase().includes(expected)) === true;
};

export const isSelectedSubscription = (document: DocumentNode, operationName?: string | null) =>
  getOperationAST(document, operationName || undefined)?.operation === 'subscription';
