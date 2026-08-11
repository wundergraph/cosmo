import { isValidHeaderName, substituteHeadersFromEnv } from '@/lib/playground-headers';
import { z } from 'zod';

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

/** Decodes the json typed into an editor, so the schemas below can describe its shape. */
const jsonText = z.string().transform((value, ctx) => {
  try {
    return JSON.parse(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid JSON' });
    return z.NEVER;
  }
});

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/** GraphQL variables are an object of arbitrary json values, sent verbatim in the request body. */
const variablesSchema = jsonText.pipe(z.record(z.string(), jsonValueSchema));

/** Header values reach the wire as strings, so scalars are coerced and anything else is dropped. */
const headerValueSchema = z.union([z.string(), z.number(), z.boolean()]).transform(String);

const headersSchema = jsonText.pipe(z.record(z.string(), z.unknown())).transform((raw) => {
  const headers: Record<string, string> = {};
  const skipped: string[] = [];

  for (const [name, value] of Object.entries(raw)) {
    const parsed = headerValueSchema.safeParse(value);
    if (parsed.success) {
      headers[name] = parsed.data;
    } else if (value !== null && value !== undefined) {
      skipped.push(name);
    }
  }

  return { headers, skipped };
});

/**
 * Parses one of the editors, reporting why it was dropped using zod's own issue messages
 * rather than throwing, so a malformed editor never blocks copying the rest of the request.
 */
const parseEditor = <S extends z.ZodType<unknown, z.ZodTypeDef, string>>(
  schema: S,
  value: string | null | undefined,
  label: string,
  warnings: string[],
): z.infer<S> | undefined => {
  if (!value?.trim()) {
    return undefined;
  }

  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const reasons = result.error.issues.map((issue) => issue.message).join('; ');
  warnings.push(`${label} were excluded from the cURL command: ${reasons}.`);

  return undefined;
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

  const parsedVariables = parseEditor(variablesSchema, variables, 'Variables', warnings);
  const parsedHeaders = parseEditor(headersSchema, headers, 'Headers', warnings);

  if (parsedHeaders && parsedHeaders.skipped.length > 0) {
    warnings.push(
      `The following headers do not have a string, number or boolean value and were excluded from the cURL command: ${parsedHeaders.skipped.join(', ')}.`,
    );
  }

  let requestHeaders: Record<string, string> = parsedHeaders?.headers ?? {};

  if (graphId) {
    requestHeaders = substituteHeadersFromEnv(requestHeaders, graphId);
  }

  requestHeaders = { ...requestHeaders, ...extraHeaders };

  // the router rejects header names that are not valid http tokens, so drop them instead of
  // producing a command that curl refuses to run
  const invalidHeaderNames = Object.keys(requestHeaders).filter((key) => !isValidHeaderName(key));
  for (const key of invalidHeaderNames) {
    delete requestHeaders[key];
  }

  if (invalidHeaderNames.length > 0) {
    warnings.push(
      `The following header names are not valid HTTP tokens and were excluded from the cURL command: ${invalidHeaderNames.join(', ')}.`,
    );
  }

  const hasContentType = Object.keys(requestHeaders).some((key) => key.toLowerCase() === 'content-type');

  const body: { query: string; operationName?: string; variables?: Record<string, JsonValue> } = { query };
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

