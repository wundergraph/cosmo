// Per-subgraph breakdown of how fetches resolved. Counted per *fetch node*
// (not per entity key) so the unit matches "Subgraph HTTP Requests" in the
// summary table. A fetch node either hits the cache (load_skipped) or makes
// an HTTP call — that's the apples-to-apples comparison for the cache ratio.
export type FetchSourceBreakdown = {
  sourceName: string;
  totalFetches: number; // fetch nodes routed to this subgraph
  l1Cached: number;     // fetches fully served from L1 (coordinate / request-scoped)
  l2Cached: number;     // fetches fully served from L2 (cross-request entity cache)
  httpCalls: number;    // fetches that required an actual HTTP call
};

// FetchPlanNode is a visual representation of one node in the router's fetch
// tree extracted from the ART trace. Used to render a side-by-side hierarchy
// of what the router did with caching on vs off, so users can see which
// fetches get eliminated, which become L1/L2 hits, and where the time goes.
export type FetchPlanNode = {
  kind: string;                 // "Sequence" | "Parallel" | "Single" | "Entity" | "BatchEntity"
  sourceName?: string;          // subgraph name for leaf fetches
  path?: string;                // response path (e.g. "currentViewer.recommendedArticles")
  query?: string;               // raw GraphQL query string sent to the subgraph (hover tooltip)
  representations?: any[];      // request representations for _entities fetches; used for stable matching
  cacheKeys?: string[];         // raw cache key strings from cache_trace.keys (click-to-expand)
  responseData?: any;           // parsed response body from output.data (may be null for cache hits)
  loadSkipped: boolean;         // router marked this as skipped (no HTTP call)
  loadDurationMs: number;       // actual HTTP round-trip time in ms (0 if skipped)
  bodySize: number;             // response body bytes
  l1Hits: number;
  l1Misses: number;
  l2Hits: number;
  l2Misses: number;
  l2GetDurationMs: number;      // time the L2 cache took to return data (from cache_trace)
  entityCount: number;
  children: FetchPlanNode[];
};

export type CacheExplorerRequestResult = {
  index: number;
  clientDurationMs: number;     // wall-clock (performance.now)
  serverDurationMs: number;     // from ART: total server processing time
  status: number;
  cacheHits: number;            // l1_hit + l2_hit across all fetches
  cacheMisses: number;          // l1_miss + l2_miss across all fetches
  entityCount: number;          // sum of entity_count across all fetches
  subgraphRequests: number;     // count of non-skipped fetch nodes with source_id
  bytesTransferred: number;     // sum of response body_size from subgraph traces
  sourceBreakdown: FetchSourceBreakdown[];
  fetchPlan?: FetchPlanNode;    // root of the fetch tree for this request
  responseData?: any;           // full GraphQL response data (for cached-vs-uncached diff)
};

export type CacheExplorerPhaseResult = {
  label: 'cached' | 'uncached';
  requests: CacheExplorerRequestResult[];
  avgClientLatencyMs: number;
  avgServerLatencyMs: number;
  minServerLatencyMs: number;
  maxServerLatencyMs: number;
  totalCacheHits: number;
  totalCacheMisses: number;
  cacheHitRatio: number;        // 0..1
  totalSubgraphRequests: number;
  totalBytesTransferred: number;
};

export type CacheExplorerResult = {
  timestamp: number;
  iterations: number;
  cached: CacheExplorerPhaseResult;
  uncached: CacheExplorerPhaseResult;
  speedup: number;              // uncached.avgServerLatencyMs / cached.avgServerLatencyMs
};

export type CacheExplorerRunningState = {
  status: 'running';
  phase: 'warmup' | 'cached' | 'uncached';
  current: number;
  total: number;
  cachedResults: CacheExplorerRequestResult[];
  uncachedResults: CacheExplorerRequestResult[];
};

export const WARMUP_ITERATIONS = 3;

export type CacheExplorerState =
  | { status: 'idle' }
  | CacheExplorerRunningState
  | { status: 'complete'; result: CacheExplorerResult }
  | { status: 'error'; message: string };
