import {
  CacheExplorerRequestResult,
  CacheExplorerPhaseResult,
  CacheExplorerResult,
  CacheExplorerState,
  FetchSourceBreakdown,
  FetchPlanNode,
  WARMUP_ITERATIONS,
} from './cache-explorer-types';
import { CacheMode } from './types';

export type CacheExplorerConfig = {
  url: string;
  query: string;
  variables?: string;     // raw JSON string from editor
  operationName?: string;
  headers: Record<string, string>;   // user's editor headers, already sanitized
  iterations: number;
  cacheMode: CacheMode;   // drives which disable headers the cached phase sends
};

type ProgressCallback = (state: CacheExplorerState) => void;

const cacheHeaderKeys = [
  'X-WG-Disable-Entity-Cache',
  'X-WG-Disable-Entity-Cache-L1',
  'X-WG-Disable-Entity-Cache-L2',
  'X-WG-Cache-Key-Prefix',
];

// Strip any pre-existing cache-control headers (case-insensitive) so the runner
// has a clean base to layer its own headers on top of.
const stripCacheHeaders = (headers: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  const blocked = new Set(cacheHeaderKeys.map((k) => k.toLowerCase()));
  for (const [k, v] of Object.entries(headers)) {
    if (!blocked.has(k.toLowerCase())) {
      out[k] = v;
    }
  }
  return out;
};

const applyCacheModeHeaders = (
  headers: Record<string, string>,
  mode: CacheMode,
): Record<string, string> => {
  const h = { ...headers };
  if (mode === 'no-l1') {
    h['X-WG-Disable-Entity-Cache-L1'] = 'true';
  } else if (mode === 'no-l2') {
    h['X-WG-Disable-Entity-Cache-L2'] = 'true';
  } else if (mode === 'disabled') {
    h['X-WG-Disable-Entity-Cache'] = 'true';
  }
  // 'enabled' → no extra headers
  return h;
};

const extractRepresentations = (trace: any): any[] | undefined => {
  const representations = trace?.input?.body?.variables?.representations;
  return Array.isArray(representations) && representations.length > 0 ? representations : undefined;
};

// Build a FetchPlanNode tree from the raw ART trace fetch structure. Preserves
// the hierarchy (Sequence/Parallel containers, nested BatchEntity fetches) so
// the UI can render a side-by-side visual of what the router did with caching
// on vs off.
const buildFetchPlan = (node: any): FetchPlanNode | undefined => {
  if (!node) return undefined;

  const t = node.trace || node.datasource_load_trace;
  const ct = t?.cache_trace;
  const bodySize: number =
    t?.output?.extensions?.trace?.response?.body_size ?? 0;

  // Load duration: prefer the actual HTTP load time. For skipped fetches with
  // cache trace timing, fall back to the cache operation duration.
  let loadNs = t?.duration_load_nanoseconds ?? 0;
  if (!loadNs && ct?.duration_nanoseconds) {
    loadNs = ct.duration_nanoseconds;
  }

  const rawKeys: string[] | undefined =
    Array.isArray(ct?.keys) && ct.keys.length > 0 ? ct.keys : undefined;

  const planNode: FetchPlanNode = {
    kind: node.kind || '?',
    sourceName: node.source_name,
    path: node.path,
    query: t?.input?.body?.query,
    representations: extractRepresentations(t),
    cacheKeys: rawKeys,
    responseData: t?.output?.data,
    loadSkipped: !!t?.load_skipped,
    loadDurationMs: loadNs / 1_000_000,
    bodySize,
    l1Hits: ct?.l1_hit || 0,
    l1Misses: ct?.l1_miss || 0,
    l2Hits: ct?.l2_hit || 0,
    l2Misses: ct?.l2_miss || 0,
    l2GetDurationMs: (ct?.l2_get_duration_nanoseconds || 0) / 1_000_000,
    entityCount: ct?.entity_count || 0,
    children: [],
  };

  const rawChildren = node.children || node.fetches || node.traces;
  if (rawChildren) {
    for (const c of rawChildren) {
      const childNode = buildFetchPlan(c.fetch || c);
      if (childNode) planNode.children.push(childNode);
    }
  }

  return planNode;
};

// Walk the trace fetch tree and aggregate cache metrics. Mirrors the existing
// collectCacheSummary pattern in index.tsx but collects more data.
//
// The source breakdown counts per *fetch node*, not per entity key, so the
// unit matches "Subgraph HTTP Requests" in the summary table. A fetch node
// either hits the cache (load_skipped=true → no HTTP call) or misses (HTTP
// call was made). This gives an apples-to-apples cache ratio.
const extractMetricsFromTrace = (
  trace: any,
): {
  cacheHits: number;
  cacheMisses: number;
  entityCount: number;
  subgraphRequests: number;
  bytesTransferred: number;
  sourceBreakdown: FetchSourceBreakdown[];
} => {
  let cacheHits = 0;
  let cacheMisses = 0;
  let entityCount = 0;
  let subgraphRequests = 0;
  let bytesTransferred = 0;
  const sourceMap = new Map<
    string,
    { totalFetches: number; l1Cached: number; l2Cached: number; httpCalls: number }
  >();

  const walk = (node: any) => {
    if (!node) return;

    const t = node.trace || node.datasource_load_trace;
    if (t) {
      const bodySize = t.output?.extensions?.trace?.response?.body_size;
      // Only count as a subgraph request if the router actually made an HTTP
      // call to the subgraph (evidenced by a non-zero response body size).
      // Cache hits short-circuit the fetch and don't produce a response body.
      if (!t.load_skipped && node.source_id && typeof bodySize === 'number' && bodySize > 0) {
        subgraphRequests++;
      }
      if (typeof bodySize === 'number') {
        bytesTransferred += bodySize;
      }

      const ct = t.cache_trace;
      if (ct) {
        const l1h = ct.l1_hit || 0;
        const l1m = ct.l1_miss || 0;
        const l2h = ct.l2_hit || 0;
        const l2m = ct.l2_miss || 0;
        cacheHits += l1h + l2h;
        cacheMisses += l1m + l2m;
        entityCount += ct.entity_count || 0;

        // Classify this fetch node by how it resolved. Each fetch node is
        // exactly one of: L1 cached, L2 cached, or HTTP call. The source
        // breakdown counts fetch nodes (not entity keys) so the cache ratio
        // uses the same unit as "Subgraph HTTP Requests".
        const sourceName: string = node.source_name || 'unknown';
        if (sourceName !== 'unknown') {
          let entry = sourceMap.get(sourceName);
          if (!entry) {
            entry = { totalFetches: 0, l1Cached: 0, l2Cached: 0, httpCalls: 0 };
            sourceMap.set(sourceName, entry);
          }
          entry.totalFetches += 1;
          if (l1h > 0 && l1m === 0) {
            // All entities in this fetch hit L1 — no HTTP call needed.
            entry.l1Cached += 1;
          } else if (l2h > 0 && l2m === 0) {
            // L1 missed (or wasn't consulted) but L2 served all — no HTTP.
            entry.l2Cached += 1;
          } else {
            // At least one entity missed both cache layers → HTTP call.
            // This also covers pass-through fetches (0/0/0/0) where no
            // cache was consulted at all.
            entry.httpCalls += 1;
          }
        }
      }
    }

    const children = node.children || node.fetches || node.traces;
    if (children) {
      for (const child of children) {
        walk(child.fetch || child);
      }
    }
  };

  walk(trace);

  const sourceBreakdown: FetchSourceBreakdown[] = [];
  sourceMap.forEach((stats, sourceName) => {
    sourceBreakdown.push({
      sourceName,
      totalFetches: stats.totalFetches,
      l1Cached: stats.l1Cached,
      l2Cached: stats.l2Cached,
      httpCalls: stats.httpCalls,
    });
  });
  sourceBreakdown.sort((a, b) => a.sourceName.localeCompare(b.sourceName));

  return {
    cacheHits,
    cacheMisses,
    entityCount,
    subgraphRequests,
    bytesTransferred,
    sourceBreakdown,
  };
};

// Compute server-side processing time in ms from the ART trace info block.
// Sums parse/normalize/validate/planner phase durations, then uses the fetch
// tree to find when the last fetch completed (execute end).
const extractServerDurationMs = (trace: any): number => {
  const info = trace?.info;
  if (!info) return 0;
  const phaseNs =
    (info.parse_stats?.duration_nanoseconds || 0) +
    (info.normalize_stats?.duration_nanoseconds || 0) +
    (info.validate_stats?.duration_nanoseconds || 0) +
    (info.planner_stats?.duration_nanoseconds || 0);

  // Find the last fetch end time relative to request start
  let maxFetchEndNs = 0;
  const plannerEndNs =
    (info.planner_stats?.duration_since_start_nanoseconds || 0) +
    (info.planner_stats?.duration_nanoseconds || 0);

  const walk = (node: any) => {
    if (!node) return;
    const t = node.trace || node.datasource_load_trace;
    if (t) {
      const start = t.duration_since_start_nanoseconds || 0;
      const load = t.duration_load_nanoseconds || 0;
      // Cache hits with no load timing fall back to cache_trace timing
      let effectiveStart = start;
      let effectiveLoad = load;
      if (!effectiveStart && t.cache_trace) {
        effectiveStart = t.cache_trace.duration_since_start_nanoseconds || 0;
        effectiveLoad = t.cache_trace.duration_nanoseconds || 0;
      }
      const end = effectiveStart + effectiveLoad;
      if (end > maxFetchEndNs) maxFetchEndNs = end;
    }
    const children = node.children || node.fetches || node.traces;
    if (children) {
      for (const child of children) {
        walk(child.fetch || child);
      }
    }
  };

  walk(trace?.fetches || trace);

  // Execute duration = maxFetchEnd - plannerEnd (time spent after planning)
  // If we have no fetches, fall back to plannerEnd.
  const executeNs = Math.max(0, maxFetchEndNs - plannerEndNs);
  const totalNs = phaseNs + executeNs;
  return totalNs / 1_000_000;
};

const runOne = async (
  config: CacheExplorerConfig,
  headers: Record<string, string>,
  index: number,
  signal: AbortSignal,
): Promise<CacheExplorerRequestResult> => {
  const body: any = {
    query: config.query,
  };
  if (config.operationName) body.operationName = config.operationName;
  if (config.variables) {
    try {
      body.variables = JSON.parse(config.variables);
    } catch {
      // ignore parse errors; send as-is if it's already an object-ish string
    }
  }

  const start = performance.now();
  const resp = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  });
  const clientDurationMs = performance.now() - start;
  const parsed = await resp.json();
  const trace = parsed?.extensions?.trace;

  const metrics = trace
    ? extractMetricsFromTrace(trace.fetches || trace)
    : {
        cacheHits: 0,
        cacheMisses: 0,
        entityCount: 0,
        subgraphRequests: 0,
        bytesTransferred: 0,
        sourceBreakdown: [],
      };

  const serverDurationMs = trace ? extractServerDurationMs(trace) : clientDurationMs;
  const fetchPlan = trace ? buildFetchPlan(trace.fetches || trace) : undefined;

  return {
    index,
    clientDurationMs,
    serverDurationMs,
    status: resp.status,
    ...metrics,
    fetchPlan,
    responseData: parsed?.data,
  };
};

const computePhaseResult = (
  label: 'cached' | 'uncached',
  requests: CacheExplorerRequestResult[],
): CacheExplorerPhaseResult => {
  if (requests.length === 0) {
    return {
      label,
      requests,
      avgClientLatencyMs: 0,
      avgServerLatencyMs: 0,
      minServerLatencyMs: 0,
      maxServerLatencyMs: 0,
      totalCacheHits: 0,
      totalCacheMisses: 0,
      cacheHitRatio: 0,
      totalSubgraphRequests: 0,
      totalBytesTransferred: 0,
    };
  }
  const sumClient = requests.reduce((acc, r) => acc + r.clientDurationMs, 0);
  const sumServer = requests.reduce((acc, r) => acc + r.serverDurationMs, 0);
  const minServer = Math.min(...requests.map((r) => r.serverDurationMs));
  const maxServer = Math.max(...requests.map((r) => r.serverDurationMs));
  const totalHits = requests.reduce((acc, r) => acc + r.cacheHits, 0);
  const totalMisses = requests.reduce((acc, r) => acc + r.cacheMisses, 0);
  const totalSubgraph = requests.reduce((acc, r) => acc + r.subgraphRequests, 0);
  const totalBytes = requests.reduce((acc, r) => acc + r.bytesTransferred, 0);
  const ratioDenom = totalHits + totalMisses;

  return {
    label,
    requests,
    avgClientLatencyMs: sumClient / requests.length,
    avgServerLatencyMs: sumServer / requests.length,
    minServerLatencyMs: minServer,
    maxServerLatencyMs: maxServer,
    totalCacheHits: totalHits,
    totalCacheMisses: totalMisses,
    cacheHitRatio: ratioDenom > 0 ? totalHits / ratioDenom : 0,
    totalSubgraphRequests: totalSubgraph,
    totalBytesTransferred: totalBytes,
  };
};

export const runCacheExplorer = async (
  config: CacheExplorerConfig,
  onProgress: ProgressCallback,
  signal: AbortSignal,
): Promise<CacheExplorerResult> => {
  if (config.cacheMode === 'disabled') {
    throw new Error('Cache mode is "disabled" — nothing to compare. Pick a cache mode first.');
  }

  const prefix = `cache-explorer-${
    (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).toString().slice(0, 12)
  }`;
  const baseHeaders = stripCacheHeaders(config.headers);
  baseHeaders['X-WG-TRACE'] = 'true';

  const cachedHeaders = applyCacheModeHeaders(baseHeaders, config.cacheMode);
  cachedHeaders['X-WG-Cache-Key-Prefix'] = prefix;

  const uncachedHeaders = { ...baseHeaders, 'X-WG-Disable-Entity-Cache': 'true' };

  const cachedResults: CacheExplorerRequestResult[] = [];
  const uncachedResults: CacheExplorerRequestResult[] = [];

  const emit = (phase: 'warmup' | 'cached' | 'uncached', current: number, total: number) => {
    onProgress({
      status: 'running',
      phase,
      current,
      total,
      cachedResults: [...cachedResults],
      uncachedResults: [...uncachedResults],
    });
  };

  // Uncached phase runs first so the user sees the baseline immediately.
  // This also means the cached phase's "warm-up" is effectively the uncached
  // phase itself — by the time we start measuring cached iterations, the L2
  // entity cache has been populated by the preceding uncached requests (with
  // a different cache key prefix, so entries don't collide). We still run an
  // explicit warm-up pass afterwards to ensure the cached-prefix entries are
  // primed for the measurement.
  for (let i = 0; i < config.iterations; i++) {
    if (signal.aborted) throw new Error('aborted');
    emit('uncached', i + 1, config.iterations);
    const result = await runOne(config, uncachedHeaders, i, signal);
    uncachedResults.push(result);
    emit('uncached', i + 1, config.iterations);
  }

  // Warm-up phase: pre-populate the cache under the cached-phase prefix so
  // the measured cached iterations are true cache hits. Results are NOT
  // recorded — these just prime the cache.
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    if (signal.aborted) throw new Error('aborted');
    emit('warmup', i + 1, WARMUP_ITERATIONS);
    await runOne(config, cachedHeaders, i, signal);
  }

  // Cached phase
  for (let i = 0; i < config.iterations; i++) {
    if (signal.aborted) throw new Error('aborted');
    emit('cached', i + 1, config.iterations);
    const result = await runOne(config, cachedHeaders, i, signal);
    cachedResults.push(result);
    emit('cached', i + 1, config.iterations);
  }

  const cached = computePhaseResult('cached', cachedResults);
  const uncached = computePhaseResult('uncached', uncachedResults);
  const speedup =
    cached.avgServerLatencyMs > 0 ? uncached.avgServerLatencyMs / cached.avgServerLatencyMs : 0;

  const result: CacheExplorerResult = {
    timestamp: Date.now(),
    iterations: config.iterations,
    cached,
    uncached,
    speedup,
  };

  onProgress({ status: 'complete', result });
  return result;
};
