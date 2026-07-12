import { substituteHeadersFromEnv, validateHeaders } from './playground-fetcher';

const reservedPlanHeaders = new Set([
  'x-wg-trace',
  'x-wg-token',
  'x-wg-include-query-plan',
  'x-wg-skip-loader',
  'x-wg-disable-tracing',
  'x-feature-flag',
]);

export const buildQueryPlanHeaders = ({
  serializedHeaders,
  graphId,
  graphRequestToken,
  featureFlagName,
}: {
  serializedHeaders: string;
  graphId: string;
  graphRequestToken: string;
  featureFlagName?: string;
}) => {
  const parsed = JSON.parse(serializedHeaders || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Headers must be a JSON object.');
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!reservedPlanHeaders.has(name.toLowerCase())) {
      headers[name] = String(value);
    }
  }
  headers['X-WG-Token'] = graphRequestToken;
  headers['X-WG-Include-Query-Plan'] = 'true';
  headers['X-WG-Skip-Loader'] = 'true';
  headers['X-WG-DISABLE-TRACING'] = 'true';
  if (featureFlagName) {
    headers['X-Feature-Flag'] = featureFlagName;
  }

  const effectiveHeaders = substituteHeadersFromEnv(headers, graphId);
  validateHeaders(effectiveHeaders);
  return effectiveHeaders;
};

export const buildQueryPlanBody = ({
  query,
  operationName,
  serializedVariables,
}: {
  query: string;
  operationName?: string | null;
  serializedVariables?: string | null;
}) => {
  const body: Record<string, unknown> = { query };
  if (operationName) {
    body.operationName = operationName;
  }
  if (serializedVariables?.trim()) {
    const variables = JSON.parse(serializedVariables);
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
      throw new TypeError('Variables must be a JSON object.');
    }
    body.variables = variables;
  }
  return body;
};
