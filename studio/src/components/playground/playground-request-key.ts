import { getOperationAST, parse } from 'graphql';

type PlaygroundRequestFingerprint = {
  headers?: string | null;
  id?: string;
  operationName?: string | null;
  query?: string | null;
  variables?: string | null;
};

type PlaygroundTargetFingerprint = {
  featureFlagName?: string;
  loadSchemaGraphId?: string;
  routingUrl?: string;
  target?: 'graph' | 'featureFlag' | 'subgraph';
};

const operationNameFromQuery = (query?: string | null) => {
  if (!query) {
    return null;
  }
  try {
    return getOperationAST(parse(query))?.name?.value ?? null;
  } catch {
    return null;
  }
};

// GraphiQL identifies restored tabs by query, variables, and headers. Keeping
// the same fingerprint here lets the initially controlled editor state adopt
// its first tab without cancelling a request that started during hydration.
export const createPlaygroundRequestKey = (
  activeTab: PlaygroundRequestFingerprint | undefined,
  fallback: PlaygroundRequestFingerprint,
  target: PlaygroundTargetFingerprint = {},
) => {
  const fallbackOperationName = fallback.operationName ?? operationNameFromQuery(fallback.query);

  return JSON.stringify({
    featureFlagName: target.featureFlagName ?? null,
    headers: activeTab?.headers ?? fallback.headers ?? null,
    loadSchemaGraphId: target.loadSchemaGraphId ?? null,
    operationName: activeTab?.operationName ?? fallbackOperationName,
    query: activeTab?.query ?? fallback.query ?? null,
    routingUrl: target.routingUrl ?? null,
    tabId: activeTab?.id ?? null,
    target: target.target ?? null,
    variables: activeTab?.variables ?? fallback.variables ?? null,
  });
};

type SerializedPlaygroundRequestKey = {
  featureFlagName: string | null;
  headers: string | null;
  loadSchemaGraphId: string | null;
  operationName: string | null;
  query: string | null;
  routingUrl: string | null;
  tabId: string | null;
  target: string | null;
  variables: string | null;
};

export const isInitialPlaygroundTabAdoption = (previousKey: string, nextKey: string) => {
  try {
    const previous = JSON.parse(previousKey) as SerializedPlaygroundRequestKey;
    const next = JSON.parse(nextKey) as SerializedPlaygroundRequestKey;
    return (
      previous.tabId === null &&
      typeof next.tabId === 'string' &&
      next.tabId.length > 0 &&
      (previous.operationName === null || previous.operationName === next.operationName) &&
      previous.featureFlagName === next.featureFlagName &&
      previous.headers === next.headers &&
      previous.loadSchemaGraphId === next.loadSchemaGraphId &&
      previous.query === next.query &&
      previous.routingUrl === next.routingUrl &&
      previous.target === next.target &&
      previous.variables === next.variables
    );
  } catch {
    return false;
  }
};
