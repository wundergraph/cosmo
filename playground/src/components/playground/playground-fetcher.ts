import { withDeferDirective } from '@wundergraph/cosmo-shared/playground/defer-schema';
import { buildClientSchema, parse, validate, type GraphQLSchema, type IntrospectionQuery } from 'graphql';
import { attachPlaygroundAPI, detachPlaygroundAPI } from './custom-scripts';

export type GraphiQLScripts = {
  transformHeaders?: (headers: Record<string, string>) => Record<string, string>;
};

export const buildPlaygroundSchema = (introspection: IntrospectionQuery) =>
  withDeferDirective(buildClientSchema(introspection));

export const schemaForGraphiQLEditor = (schema: GraphQLSchema | null) => schema ?? undefined;

export const buildDeferAdvisorHeaders = (
  effectiveHeaders: Record<string, string>,
  { runs, skipValidation = false }: { runs: number; skipValidation?: boolean },
): Record<string, string> => {
  const existingHeaders = { ...effectiveHeaders };
  for (const name of Object.keys(existingHeaders)) {
    if (name.toLowerCase() === 'x-wg-trace') {
      delete existingHeaders[name];
    }
  }
  return {
    ...existingHeaders,
    'Content-Type': 'application/json',
    'X-WG-Defer-Advisor': 'enable',
    'X-WG-Defer-Advisor-Runs': String(runs),
    ...(skipValidation ? { 'X-WG-Defer-Advisor-Skip-Validation': 'true' } : {}),
  };
};

export const validateHeaders = (headers: Record<string, string>) => {
  for (const headersKey in headers) {
    if (!/^[\^`\-\w!#$%&'*+.|~]+$/.test(headersKey)) {
      throw new TypeError(`Header name must be a valid HTTP token [${headersKey}]`);
    }
  }
};

export const substituteHeadersFromEnv = (headers: Record<string, string>, graphId: string) => {
  let env: Record<string, Record<string, unknown>>;
  try {
    env = JSON.parse(globalThis.localStorage?.getItem('playground:env') || '{}');
  } catch {
    return headers;
  }
  const graphEnv = env[graphId];
  if (!graphEnv) {
    return headers;
  }

  const storedHeaders: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(graphEnv)) {
    if (value === 'true' || value === 'false') {
      storedHeaders[key] = value === 'true';
    } else if (!Number.isNaN(Number(value)) && value !== '') {
      storedHeaders[key] = Number(value);
    } else {
      storedHeaders[key] = value;
    }
  }

  for (const key in headers) {
    const value = headers[key];
    if (typeof value !== 'string') {
      continue;
    }
    headers[key] = value.replace(/{\s*{\s*(\w+)\s*}\s*}/g, (match, name) => {
      if (storedHeaders[name] !== undefined) {
        return String(storedHeaders[name]);
      }
      console.warn(`No value found for placeholder: ${name}`);
      return match;
    });
  }
  return headers;
};

export const preparePlaygroundHeaders = (
  headers: Record<string, string>,
  scripts?: GraphiQLScripts,
  graphId = '0',
): Record<string, string> => {
  const initialHeaders = { ...headers };
  const transformedHeaders = scripts?.transformHeaders ? scripts.transformHeaders(initialHeaders) : initialHeaders;
  const effectiveHeaders = substituteHeadersFromEnv({ ...transformedHeaders }, graphId);
  validateHeaders(effectiveHeaders);
  return effectiveHeaders;
};

const executeScript = async (code: string | undefined) => {
  if (!code) {
    return;
  }
  try {
    const asyncEval = new Function(`
      return (async () => {
        ${code}
      })();
    `);
    await asyncEval();
  } catch (error) {
    console.error(error);
  }
};

const retrieveScript = (key: string) => {
  let selectedScript: string | null = null;
  try {
    selectedScript = globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    // Storage may be disabled by the embedding browser.
  }
  return JSON.parse(!selectedScript || selectedScript === 'undefined' ? '{}' : selectedScript);
};

export const executePreScripts = async (graphId: string, requestBody: unknown) => {
  const preflightScript = retrieveScript('playground:pre-flight:selected');
  const preflightEnabled = globalThis.localStorage?.getItem('playground:pre-flight:enabled');
  const preOperationScript = retrieveScript('playground:pre-operation:selected');
  const shouldRunPreflight = (!preflightEnabled || preflightEnabled === 'true') && !!preflightScript.content;
  const shouldRunPreOperation = !!preOperationScript.enabled && !!preOperationScript.content;
  if (!shouldRunPreflight && !shouldRunPreOperation) {
    return;
  }

  attachPlaygroundAPI(graphId, requestBody);
  try {
    if (shouldRunPreflight) {
      await executeScript(preflightScript.content);
    }
    if (shouldRunPreOperation) {
      await executeScript(preOperationScript.content);
    }
  } finally {
    detachPlaygroundAPI();
  }
};

export const executePostScripts = async (graphId: string, requestBody: unknown, responseBody: unknown) => {
  const script = retrieveScript('playground:post-operation:selected');
  if (!script.enabled || !script.content) {
    return;
  }
  attachPlaygroundAPI(graphId, requestBody, responseBody);
  try {
    await executeScript(script.content);
  } finally {
    detachPlaygroundAPI();
  }
};

type PlaygroundHTTPFetchOptions = {
  fetchImplementation: typeof fetch;
  schema: GraphQLSchema | null;
  clientValidationEnabled: boolean;
  scripts?: GraphiQLScripts;
  runPreOperation?: (graphId: string, requestBody: unknown) => void | Promise<void>;
  onResponseStatus?: (status?: number, statusText?: string) => void;
};

const headersRecord = (headers: HeadersInit | undefined): Record<string, string> => {
  if (headers instanceof Headers || Array.isArray(headers)) {
    return Object.fromEntries(new Headers(headers).entries());
  }
  return { ...(headers ?? {}) } as Record<string, string>;
};

// GraphiQL parses JSON and multipart bodies. This transport only prepares the
// request and returns the original Response, preserving streaming/backpressure.
export const createPlaygroundHTTPFetch =
  ({
    fetchImplementation,
    schema,
    clientValidationEnabled,
    scripts,
    runPreOperation = executePreScripts,
    onResponseStatus,
  }: PlaygroundHTTPFetchOptions): typeof fetch =>
  async (input, init) => {
    try {
      const initialHeaders = headersRecord(init?.headers);
      const headers = preparePlaygroundHeaders(initialHeaders, scripts);

      const requestBody = JSON.parse(String(init?.body));
      if (schema && clientValidationEnabled) {
        const errors = validate(schema, parse(requestBody.query));
        if (errors.length > 0) {
          const response = new Response(
            JSON.stringify({
              message: 'Client-side validation failed. The request was not sent to the Router.',
              errors: errors.map((error) => ({
                message: error.message,
                path: error.path,
                locations: error.locations,
              })),
            }),
            { headers: { 'content-type': 'application/json' } },
          );
          onResponseStatus?.();
          return response;
        }
      }

      await runPreOperation('0', requestBody);
      const response = await fetchImplementation(input, { ...init, headers });
      onResponseStatus?.(response.status, response.statusText);
      return response;
    } catch (error) {
      const customMessage =
        'Failed to fetch from router due to network errors. Please check network activity in browser dev tools for more details.';
      const message =
        error instanceof Error && error.message
          ? error.message === 'Failed to fetch'
            ? customMessage
            : error.message
          : customMessage;
      onResponseStatus?.(undefined, 'Network Error');
      const normalized = new Error(message);
      (normalized as Error & { cause?: unknown }).cause = error;
      throw normalized;
    }
  };
