import { attachPlaygroundAPI, detachPlaygroundAPI } from '@/components/playground/custom-scripts';
import { parse, validate, type GraphQLSchema } from 'graphql';

export type PlaygroundTarget = 'graph' | 'featureFlag' | 'subgraph';

export type StudioPlaygroundFetchResult =
  | { kind: 'response'; ok: boolean; status: number; statusText: string }
  | { kind: 'validation' }
  | { kind: 'network-error' };

type StudioPlaygroundFetchOptions = {
  clientValidationEnabled: boolean;
  featureFlagName?: string;
  fetchImpl?: typeof fetch;
  graphId: string;
  graphRequestToken: string;
  onResult?(result: StudioPlaygroundFetchResult): void;
  schema?: GraphQLSchema | null;
  signal?: AbortSignal;
  target: PlaygroundTarget;
};

const headersToRecord = (headers?: HeadersInit): Record<string, string> => {
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([name, value]) => [name, String(value)]));
  }
  return Object.fromEntries(Object.entries(headers ?? {}).map(([name, value]) => [name, String(value)]));
};

export const validateHeaders = (headers: Record<string, string>) => {
  for (const headerName of Object.keys(headers)) {
    if (!/^[\^`\-\w!#$%&'*+.|~]+$/.test(headerName)) {
      throw new TypeError(`Header name must be a valid HTTP token [${headerName}]`);
    }
  }
};

export const substituteHeadersFromEnv = (headers: Record<string, string>, graphId: string) => {
  const env = JSON.parse(localStorage.getItem('playground:env') || '{}');
  const graphEnv: Record<string, unknown> | undefined = env[graphId];

  if (!graphEnv) {
    return headers;
  }

  for (const key of Object.keys(headers)) {
    headers[key] = headers[key].replace(/{\s*{\s*(\w+)\s*}\s*}/g, (match, variableName: string) => {
      const value = graphEnv[variableName];
      if (value === undefined) {
        console.warn(`No value found for placeholder: ${variableName}`);
        return match;
      }
      return String(value);
    });
  }

  return headers;
};

export const hasNonEmptyTraceOption = (headers: Record<string, string>) =>
  Object.entries(headers).some(
    ([headerName, value]) => headerName.toLowerCase() === 'x-wg-trace' && value.trim().length > 0,
  );

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

const retrieveScriptFromLocalStorage = (key: string) => {
  const selectedScript = localStorage.getItem(key);
  return JSON.parse(!selectedScript || selectedScript === 'undefined' ? '{}' : selectedScript);
};

const executePreScripts = async (graphId: string, requestBody: unknown) => {
  attachPlaygroundAPI(graphId, requestBody);
  try {
    const preflightScript = retrieveScriptFromLocalStorage('playground:pre-flight:selected');
    const preFlightScriptEnabled = localStorage.getItem('playground:pre-flight:enabled');
    const preOperationScript = retrieveScriptFromLocalStorage('playground:pre-operation:selected');

    if (!preFlightScriptEnabled || preFlightScriptEnabled === 'true') {
      await executeScript(preflightScript.content);
    }
    if (preOperationScript.enabled) {
      await executeScript(preOperationScript.content);
    }
  } finally {
    detachPlaygroundAPI();
  }
};

export const executePostScripts = async (graphId: string, requestBody: unknown, responseBody: unknown) => {
  const script = retrieveScriptFromLocalStorage('playground:post-operation:selected');
  if (!script.enabled) {
    return;
  }

  attachPlaygroundAPI(graphId, requestBody, responseBody);
  try {
    await executeScript(script.content);
  } finally {
    detachPlaygroundAPI();
  }
};

const validationResponse = (schema: GraphQLSchema, requestBody: Record<string, unknown>) => {
  try {
    const query = typeof requestBody.query === 'string' ? requestBody.query : '';
    const errors = validate(schema, parse(query));
    if (errors.length === 0) {
      return;
    }

    return Response.json({
      message: 'Client-side validation failed. The request was not sent to the Router.',
      errors: errors.map((error) => ({
        message: error.message,
        path: error.path,
        locations: error.locations,
      })),
    });
  } catch (error) {
    const graphQLError = error as {
      message?: string;
      locations?: readonly unknown[];
      path?: readonly (string | number)[];
    };
    return Response.json({
      message: 'Client-side validation failed. The request was not sent to the Router.',
      errors: [
        {
          message: graphQLError.message ?? 'The operation could not be parsed.',
          path: graphQLError.path,
          locations: graphQLError.locations,
        },
      ],
    });
  }
};

const networkErrorResponse = (error: unknown) => {
  const defaultMessage =
    'Failed to fetch from router due to network errors. Please check network activity in browser dev tools for more details.';
  const message =
    error instanceof Error && error.message
      ? error.message === 'Failed to fetch'
        ? defaultMessage
        : error.message
      : defaultMessage;
  return Response.json(message);
};

const isAbortError = (error: unknown) =>
  !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError';

export const createStudioPlaygroundFetch =
  (options: StudioPlaygroundFetchOptions): typeof fetch =>
  async (input, init) => {
    try {
      const headers = substituteHeadersFromEnv(headersToRecord(init?.headers), options.graphId);
      validateHeaders(headers);

      if (options.target !== 'subgraph' && options.graphRequestToken && hasNonEmptyTraceOption(headers)) {
        for (const headerName of Object.keys(headers)) {
          if (headerName.toLowerCase() === 'x-wg-token') {
            delete headers[headerName];
          }
        }
        headers['X-WG-Token'] = options.graphRequestToken;
      }
      if (options.featureFlagName) {
        headers['X-Feature-Flag'] = options.featureFlagName;
      }

      const requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (options.schema && options.clientValidationEnabled) {
        const response = validationResponse(options.schema, requestBody);
        if (response) {
          options.onResult?.({ kind: 'validation' });
          return response;
        }
      }

      await executePreScripts(options.graphId, requestBody);
      const response = await (options.fetchImpl ?? globalThis.fetch)(input, {
        ...init,
        headers,
        signal: options.signal ?? init?.signal,
      });
      options.onResult?.({
        kind: 'response',
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
      });
      return response;
    } catch (error) {
      if (options.signal?.aborted && isAbortError(error)) {
        throw error;
      }
      options.onResult?.({ kind: 'network-error' });
      return networkErrorResponse(error);
    }
  };
