import { substituteHeadersFromEnv } from '@/lib/playground-headers';

interface BuildCurlOptions {
  url: string;
  query: string;
  variables?: string | null;
  headers?: string | null;
  operationName?: string | null;
  graphId?: string;
  /** Headers the playground adds on its own, e.g. the feature flag selected in the toolbar. */
  extraHeaders?: Record<string, string>;
}

export interface BuildCurlResult {
  command: string;
  /** Non fatal issues, e.g. malformed variables that had to be skipped. */
  warnings: string[];
}

/**
 * Wraps a value in single quotes for a POSIX shell. Single quotes inside the value are
 * closed, escaped and reopened ('\'') since there is no escaping within single quotes.
 */
const shellQuote = (value: string) => `'${value.split("'").join(`'\\''`)}'`;

const parseJsonObject = (value: string | null | undefined): Record<string, any> | undefined => {
  if (!value || !value.trim()) {
    return undefined;
  }

  const parsed = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Expected a JSON object');
  }

  return parsed;
};

export const buildCurlCommand = ({
  url,
  query,
  variables,
  headers,
  operationName,
  graphId,
  extraHeaders,
}: BuildCurlOptions): BuildCurlResult => {
  const warnings: string[] = [];

  let parsedVariables: Record<string, any> | undefined;
  try {
    parsedVariables = parseJsonObject(variables);
  } catch {
    warnings.push('Variables are not valid JSON and were excluded from the cURL command.');
  }

  let parsedHeaders: Record<string, any> | undefined;
  try {
    parsedHeaders = parseJsonObject(headers);
  } catch {
    warnings.push('Headers are not valid JSON and were excluded from the cURL command.');
  }

  let requestHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsedHeaders ?? {})) {
    if (value === null || value === undefined) {
      continue;
    }

    requestHeaders[key] = typeof value === 'string' ? value : String(value);
  }

  if (graphId) {
    requestHeaders = substituteHeadersFromEnv(requestHeaders, graphId);
  }

  requestHeaders = { ...requestHeaders, ...extraHeaders };

  const hasContentType = Object.keys(requestHeaders).some((key) => key.toLowerCase() === 'content-type');

  const body: Record<string, any> = { query };
  if (operationName) {
    body.operationName = operationName;
  }
  if (parsedVariables) {
    body.variables = parsedVariables;
  }

  const parts = [`curl ${shellQuote(url)}`];

  if (!hasContentType) {
    parts.push(`-H ${shellQuote('Content-Type: application/json')}`);
  }

  for (const [key, value] of Object.entries(requestHeaders)) {
    parts.push(`-H ${shellQuote(`${key}: ${value}`)}`);
  }

  parts.push(`--data-raw ${shellQuote(JSON.stringify(body))}`);

  return {
    command: parts.join(' \\\n  '),
    warnings,
  };
};
