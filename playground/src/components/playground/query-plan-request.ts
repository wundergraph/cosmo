import { preparePlaygroundHeaders, type GraphiQLScripts } from './playground-fetcher';

const reservedPlanHeaders = new Set([
  'x-wg-trace',
  'x-wg-include-query-plan',
  'x-wg-skip-loader',
  'x-wg-disable-tracing',
]);

export const buildQueryPlanHeaders = (serializedHeaders: string, scripts?: GraphiQLScripts) => {
  const parsed = JSON.parse(serializedHeaders || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Headers must be a JSON object.');
  }
  const effectiveHeaders = preparePlaygroundHeaders(parsed, scripts);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(effectiveHeaders)) {
    if (!reservedPlanHeaders.has(name.toLowerCase())) {
      headers[name] = String(value);
    }
  }
  return {
    ...headers,
    'X-WG-Include-Query-Plan': 'true',
    'X-WG-Skip-Loader': 'true',
    'X-WG-DISABLE-TRACING': 'true',
  };
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
