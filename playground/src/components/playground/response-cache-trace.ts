// Response cache part of ART. Kept identical in studio and playground.

export type ResponseCacheStatus = 'hit' | 'partial_hit' | 'miss' | 'not_cacheable';

export type ResponseCacheInvalidation = {
  cacheTag: boolean;
  subgraph: boolean;
  type: boolean;
  endpoint?: string;
};

export type ResponseCacheEntry = {
  alias?: string;
  // path is the response path of a merged fetch's entry.
  path?: string;
  index: number;
  key: string;
  privateKey?: string;
  found: boolean;
  served: boolean;
  private: boolean;
  writtenPrivate: boolean;
  remainingTTL?: string;
  vary?: string[][];
  written: boolean;
  writtenKey?: string;
  writeTTL?: string;
  typeName?: string;
  declaredTags: string[];
  tags: string[];
  surrogateKeys: string[];
  value?: unknown;
};

export type ResponseCacheTrace = {
  status: ResponseCacheStatus;
  storeDecision?: string;
  keysRequested: number;
  keysFound: number;
  privateId: boolean;
  lookupDuration?: string;
  cacheControl?: string;
  vary?: string;
  writeError?: string;
  entries: ResponseCacheEntry[];
};

export type CacheTagHeader = {
  name: string;
  value?: string;
  outcome: 'empty' | 'complete' | 'truncated';
  emitted: boolean;
  size: number;
  untruncatedSize: number;
  maxBytes: number;
  dropped: string[];
  rejected: string[];
};

export type ResponseCacheRequestTrace = {
  surrogateKeys: string[];
  tagHeader?: CacheTagHeader;
  invalidation?: ResponseCacheInvalidation;
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []);

export const parseResponseCacheTrace = (raw: any): ResponseCacheTrace | undefined => {
  if (!raw || typeof raw !== 'object' || typeof raw.status !== 'string') {
    return undefined;
  }
  return {
    status: raw.status,
    storeDecision: raw.store_decision,
    keysRequested: raw.keys_requested ?? 0,
    keysFound: raw.keys_found ?? 0,
    privateId: !!raw.private_id,
    lookupDuration: raw.lookup_duration_pretty,
    cacheControl: raw.cache_control,
    vary: raw.vary,
    writeError: raw.write_error,
    entries: (Array.isArray(raw.entries) ? raw.entries : []).map(
      (e: any): ResponseCacheEntry => ({
        alias: e.alias,
        path: e.path,
        index: e.index ?? 0,
        key: e.key,
        privateKey: e.private_key,
        found: !!e.found,
        served: !!e.served,
        private: !!e.private,
        writtenPrivate: !!e.written_private,
        remainingTTL: e.remaining_ttl_pretty,
        vary: e.vary,
        written: !!e.written,
        writtenKey: e.written_key,
        writeTTL: e.write_ttl_pretty,
        typeName: e.type_name,
        declaredTags: strings(e.declared_tags),
        tags: strings(e.tags),
        surrogateKeys: strings(e.surrogate_keys),
        value: e.value,
      }),
    ),
  };
};

export const parseResponseCacheRequestTrace = (raw: any): ResponseCacheRequestTrace | undefined => {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const tagHeader = raw.details?.tag_header;
  const invalidation = raw.details?.invalidation;
  return {
    surrogateKeys: strings(raw.surrogate_keys),
    tagHeader: tagHeader
      ? {
          name: tagHeader.name,
          value: tagHeader.value,
          outcome: tagHeader.outcome,
          emitted: !!tagHeader.emitted,
          size: tagHeader.size ?? 0,
          untruncatedSize: tagHeader.untruncated_size ?? 0,
          maxBytes: tagHeader.max_bytes ?? 0,
          dropped: strings(tagHeader.dropped),
          rejected: strings(tagHeader.rejected),
        }
      : undefined,
    invalidation: invalidation
      ? {
          cacheTag: !!invalidation.cache_tag,
          subgraph: !!invalidation.subgraph,
          type: !!invalidation.type,
          endpoint: invalidation.endpoint,
        }
      : undefined,
  };
};

export const responseCacheStatusLabel = (status: ResponseCacheStatus): string => {
  switch (status) {
    case 'hit':
      return 'HIT';
    case 'partial_hit':
      return 'PARTIAL HIT';
    case 'miss':
      return 'MISS';
    default:
      return 'NOT CACHEABLE';
  }
};

export type InvalidationRequest = {
  label: string;
  body: Record<string, unknown>;
};

// invalidationRequests are the requests that would drop the entry, finest first, for the maintained indexes.
export const invalidationRequests = (
  entry: ResponseCacheEntry,
  subgraph: string,
  invalidation?: ResponseCacheInvalidation,
): InvalidationRequest[] => {
  if (!invalidation) {
    return [];
  }
  const requests: InvalidationRequest[] = [];
  if (invalidation.cacheTag) {
    for (const tag of entry.declaredTags) {
      requests.push({ label: `Tag ${tag}`, body: { kind: 'cache_tag', subgraphs: [subgraph], cache_tag: tag } });
    }
  }
  if (invalidation.type && entry.typeName) {
    requests.push({
      label: `Type ${entry.typeName}`,
      body: { kind: 'type', subgraph, type: entry.typeName },
    });
  }
  if (invalidation.subgraph) {
    requests.push({ label: `Subgraph ${subgraph}`, body: { kind: 'subgraph', subgraph } });
  }
  return requests;
};

// invalidationCurl never carries the shared key, it reads it from the environment.
const shellQuote = (s: string) => s.replace(/'/g, "'\\''");

export const invalidationCurl = (endpoint: string, requests: InvalidationRequest[]): string => {
  const body = shellQuote(JSON.stringify(requests.map((r) => r.body)));
  endpoint = shellQuote(endpoint);
  return `curl -X POST '${endpoint}' \\\n  -H "Authorization: $INVALIDATION_SHARED_KEY" \\\n  -H 'Content-Type: application/json' \\\n  -d '${body}'`;
};

// isRootFetch reports a fetch of root fields rather than entities; its one entry has no type.
export const isRootFetch = (kind?: string) => kind?.toLowerCase() === 'single';

export const entryLabel = (entry: ResponseCacheEntry, kind?: string) => {
  if (isRootFetch(kind)) {
    return 'Root fields';
  }
  const name = entry.path || entry.alias;
  return name ? `${name} #${entry.index}` : `Entity #${entry.index}`;
};

export type MergedEntrySummary = {
  name: string;
  total: number;
  served: number;
};

// mergedEntrySummary is how much of each merged entry came from the cache; empty unless the fetch was merged.
export const mergedEntrySummary = (trace: ResponseCacheTrace): MergedEntrySummary[] => {
  const groups = new Map<string, MergedEntrySummary>();
  for (const entry of trace.entries) {
    if (!entry.alias) {
      continue;
    }
    const name = entry.path || entry.alias;
    const group = groups.get(name) ?? { name, total: 0, served: 0 };
    group.total++;
    group.served += entry.served ? 1 : 0;
    groups.set(name, group);
  }
  return [...groups.values()];
};

export type CachedFetch = {
  subgraph: string;
  kind?: string;
  trace: ResponseCacheTrace;
};

type CacheTraceNode = {
  type?: string;
  dataSourceName?: string;
  responseCache?: ResponseCacheTrace;
  children?: CacheTraceNode[];
};

// collectCachedFetches lists the plan's fetches that have a cache trace, in plan order.
export const collectCachedFetches = (node?: CacheTraceNode): CachedFetch[] => {
  if (!node) {
    return [];
  }
  const own = node.responseCache
    ? [{ subgraph: node.dataSourceName ?? 'subgraph', kind: node.type, trace: node.responseCache }]
    : [];
  return [...own, ...(node.children ?? []).flatMap(collectCachedFetches)];
};

export type OperationInvalidationRequest = InvalidationRequest & {
  // entries is how many of this response's entries the request drops.
  entries: number;
};

export type SubgraphInvalidationRequests = {
  subgraph: string;
  requests: OperationInvalidationRequest[];
  // rootEntries have no type, so only a subgraph or tag request drops them.
  // Counts are of entries this response left in the cache: found or written.
  rootEntries: number;
};

// operationInvalidationRequests are every entry's invalidation requests, deduplicated, grouped by subgraph.
export const operationInvalidationRequests = (
  fetches: CachedFetch[],
  invalidation?: ResponseCacheInvalidation,
): SubgraphInvalidationRequests[] => {
  const groups = new Map<string, { requests: Map<string, OperationInvalidationRequest>; rootEntries: number }>();
  if (!invalidation) {
    return [];
  }
  for (const { subgraph, kind, trace } of fetches) {
    for (const entry of trace.entries) {
      if (!entry.found && !entry.written) {
        continue;
      }
      const group = groups.get(subgraph) ?? { requests: new Map(), rootEntries: 0 };
      groups.set(subgraph, group);
      group.rootEntries += isRootFetch(kind) ? 1 : 0;
      for (const request of invalidationRequests(entry, subgraph, invalidation)) {
        const id = JSON.stringify(request.body);
        group.requests.set(id, { ...request, entries: (group.requests.get(id)?.entries ?? 0) + 1 });
      }
    }
  }
  return [...groups].map(([subgraph, group]) => ({
    subgraph,
    requests: [...group.requests.values()],
    rootEntries: group.rootEntries,
  }));
};

export type InvalidationResult = {
  ok: boolean;
  message: string;
};

// sendInvalidation posts the requests to the router's invalidation endpoint.
export const sendInvalidation = async (
  endpoint: string,
  sharedKey: string,
  requests: InvalidationRequest[],
): Promise<InvalidationResult> => {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: sharedKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(requests.map((r) => r.body)),
    });
  } catch (e) {
    return { ok: false, message: `Could not reach ${endpoint}: ${e instanceof Error ? e.message : String(e)}` };
  }
  const body = await res.json().catch(() => undefined);
  if (res.ok) {
    const count = typeof body?.count === 'number' ? body.count : 0;
    return { ok: true, message: `Removed ${count} ${count === 1 ? 'entry' : 'entries'}.` };
  }
  const errors = Array.isArray(body?.errors) ? body.errors.map((e: any) => e?.message).filter(Boolean) : [];
  return { ok: false, message: `${res.status}: ${errors.join('; ') || res.statusText}` };
};
