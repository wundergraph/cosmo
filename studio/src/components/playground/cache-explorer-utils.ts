import { FetchPlanNode } from './cache-explorer-types';

export type FetchPair = {
  cached?: FetchPlanNode;
  uncached?: FetchPlanNode;
};

const stripSyntheticPrefix = (raw: string): string => {
  const jsonStart = raw.indexOf('{');
  if (jsonStart < 0) return raw;
  const prefix = raw.slice(0, jsonStart);
  if (/^(cache-explorer|explorer)-/.test(prefix)) {
    return raw.slice(jsonStart);
  }
  return raw;
};

const stableStringify = (value: any): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const normalizeEntityIdentity = (__typename: string, key: any): string => {
  return stableStringify({ __typename, key });
};

const extractCacheKeyIdentities = (keys?: string[]): string[] => {
  if (!keys || keys.length === 0) return [];
  const identities = new Set<string>();
  for (const raw of keys) {
    try {
      const parsed = JSON.parse(stripSyntheticPrefix(raw));
      if (parsed?.__typename && parsed?.key && typeof parsed.key === 'object') {
        identities.add(normalizeEntityIdentity(parsed.__typename, parsed.key));
      }
    } catch {
      // Ignore malformed cache keys in the UI matcher.
    }
  }
  return Array.from(identities).sort();
};

const extractResponseIdentitiesInto = (value: any, out: Set<string>) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      extractResponseIdentitiesInto(item, out);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }

  if (value.__typename && value.id != null) {
    out.add(normalizeEntityIdentity(String(value.__typename), { id: String(value.id) }));
  }

  for (const child of Object.values(value)) {
    extractResponseIdentitiesInto(child, out);
  }
};

const extractResponseIdentities = (responseData: any): string[] => {
  if (responseData == null) return [];
  const identities = new Set<string>();
  extractResponseIdentitiesInto(responseData, identities);
  return Array.from(identities).sort();
};

const extractRepresentationsIdentity = (representations?: any[]): string => {
  if (!representations || representations.length === 0) return '';
  return representations.map((representation) => stableStringify(representation)).join('|');
};

const fetchBucket = (node: FetchPlanNode): string => [node.path || '', node.sourceName || ''].join('||');

const fetchIdentity = (node: FetchPlanNode): string => {
  const representationsIdentity = extractRepresentationsIdentity(node.representations);
  if (representationsIdentity) {
    return representationsIdentity;
  }
  const cacheIdentities = extractCacheKeyIdentities(node.cacheKeys);
  if (cacheIdentities.length > 0) {
    return cacheIdentities.join('|');
  }
  const responseIdentities = extractResponseIdentities(node.responseData);
  if (responseIdentities.length > 0) {
    return responseIdentities.join('|');
  }
  return '';
};

const summarizeIdentity = (identity: string): string => {
  if (!identity) return '';
  try {
    const parsed = JSON.parse(identity);
    const typename = parsed?.__typename;
    const key = parsed?.key;
    if (typename && key && typeof key === 'object') {
      const parts = Object.entries(key)
        .map(([k, v]) => `${k}:${String(v)}`)
        .join(', ');
      return `${typename}{${parts}}`;
    }
  } catch {
    // fall through
  }
  return identity;
};

const isContainerNode = (node: FetchPlanNode): boolean => node.kind === 'Sequence' || node.kind === 'Parallel';

const flattenLeafFetches = (root: FetchPlanNode | undefined): FetchPlanNode[] => {
  if (!root) return [];
  const out: FetchPlanNode[] = [];
  const walk = (node: FetchPlanNode) => {
    if (isContainerNode(node)) {
      for (const child of node.children || []) {
        walk(child);
      }
      return;
    }
    out.push(node);
  };
  walk(root);
  return out;
};

export const formatCacheKey = (raw: string): string => {
  const withoutPrefix = stripSyntheticPrefix(raw);
  try {
    const pretty = JSON.stringify(JSON.parse(withoutPrefix), null, 2);
    return pretty;
  } catch {
    return withoutPrefix;
  }
};

export const dedupeCacheKeysForDisplay = (keys?: string[]): string[] => {
  if (!keys || keys.length === 0) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keys) {
    const normalized = stripSyntheticPrefix(raw);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(raw);
  }
  return out;
};

export const summarizeFetchIdentity = (node?: FetchPlanNode): string | undefined => {
  if (!node) return undefined;
  const identity = fetchIdentity(node);
  if (!identity) return undefined;
  const parts = identity.split('|').filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return summarizeIdentity(parts[0]);
  return `${parts.length} entities`;
};

export const collectFetchPairs = (
  cached: FetchPlanNode | undefined,
  uncached: FetchPlanNode | undefined,
): Array<{ path: string; pair: FetchPair }> => {
  const cachedLeaves = flattenLeafFetches(cached);
  const uncachedLeaves = flattenLeafFetches(uncached);
  const bucketOrder: string[] = [];
  const seenBuckets = new Set<string>();
  const rememberBucket = (bucket: string) => {
    if (!seenBuckets.has(bucket)) {
      seenBuckets.add(bucket);
      bucketOrder.push(bucket);
    }
  };

  const cachedByBucket = new Map<string, FetchPlanNode[]>();
  for (const node of cachedLeaves) {
    const bucket = fetchBucket(node);
    rememberBucket(bucket);
    const list = cachedByBucket.get(bucket) || [];
    list.push(node);
    cachedByBucket.set(bucket, list);
  }

  const uncachedByBucket = new Map<string, FetchPlanNode[]>();
  for (const node of uncachedLeaves) {
    const bucket = fetchBucket(node);
    rememberBucket(bucket);
    const list = uncachedByBucket.get(bucket) || [];
    list.push(node);
    uncachedByBucket.set(bucket, list);
  }

  const out: Array<{ path: string; pair: FetchPair }> = [];

  for (const bucket of bucketOrder) {
    const cachedNodes = [...(cachedByBucket.get(bucket) || [])];
    const uncachedNodes = [...(uncachedByBucket.get(bucket) || [])];
    const remainingUncached = new Set<number>(uncachedNodes.map((_, i) => i));

    const uncachedByIdentity = new Map<string, number[]>();
    for (let i = 0; i < uncachedNodes.length; i++) {
      const identity = fetchIdentity(uncachedNodes[i]);
      if (!identity) continue;
      const list = uncachedByIdentity.get(identity) || [];
      list.push(i);
      uncachedByIdentity.set(identity, list);
    }

    for (const cachedNode of cachedNodes) {
      const identity = fetchIdentity(cachedNode);
      let matchedIndex: number | undefined;
      if (identity) {
        const candidates = uncachedByIdentity.get(identity);
        while (candidates && candidates.length > 0) {
          const idx = candidates.shift();
          if (idx != null && remainingUncached.has(idx)) {
            matchedIndex = idx;
            break;
          }
        }
      }
      if (matchedIndex == null) {
        matchedIndex = Array.from(remainingUncached).sort((a, b) => a - b)[0];
      }

      if (matchedIndex != null) {
        remainingUncached.delete(matchedIndex);
        const uncachedNode = uncachedNodes[matchedIndex];
        const ref = cachedNode || uncachedNode;
        out.push({
          path: ref.path || '',
          pair: { cached: cachedNode, uncached: uncachedNode },
        });
      } else {
        out.push({
          path: cachedNode.path || '',
          pair: { cached: cachedNode },
        });
      }
    }

    for (const idx of Array.from(remainingUncached).sort((a, b) => a - b)) {
      const uncachedNode = uncachedNodes[idx];
      out.push({
        path: uncachedNode.path || '',
        pair: { uncached: uncachedNode },
      });
    }
  }

  return out;
};
