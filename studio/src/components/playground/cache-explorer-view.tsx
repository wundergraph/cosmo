import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BoltIcon } from '@heroicons/react/24/solid';
import { LuActivity } from 'react-icons/lu';
import { ExclamationTriangleIcon } from '@radix-ui/react-icons';
import { parse as gqlParse, print as gqlPrint } from 'graphql';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { EmptyState } from '../empty-state';
import { cacheExplorerController } from './cache-explorer-controller';
import {
  collectFetchPairs,
  dedupeCacheKeysForDisplay,
  FetchPair,
  formatCacheKey,
  summarizeFetchIdentity,
} from './cache-explorer-utils';
import {
  CacheExplorerPhaseResult,
  CacheExplorerRequestResult,
  CacheExplorerState,
  FetchPlanNode,
} from './cache-explorer-types';
import { WARMUP_ITERATIONS } from './cache-explorer-types';
import { CacheMode, PlaygroundContext } from './types';

const cacheModeLabels: Record<CacheMode, string> = {
  enabled: 'Caching enabled (L1 + L2)',
  'no-l1': 'Caching (L2 only)',
  'no-l2': 'Caching (L1 only)',
  disabled: 'Cache disabled',
};

// --- Formatters ---

const formatMs = (ms: number): string => {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 10) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
};

const formatPercent = (v: number): string => `${(v * 100).toFixed(0)}%`;

// --- Running phase aggregation (partial results for live stats) ---

const aggregatePartial = (reqs: CacheExplorerRequestResult[]): CacheExplorerPhaseResult => {
  if (reqs.length === 0) {
    return {
      label: 'cached',
      requests: reqs,
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
  const serverLats = reqs.map((r) => r.serverDurationMs);
  const hits = reqs.reduce((a, r) => a + r.cacheHits, 0);
  const misses = reqs.reduce((a, r) => a + r.cacheMisses, 0);
  return {
    label: 'cached',
    requests: reqs,
    avgClientLatencyMs: reqs.reduce((a, r) => a + r.clientDurationMs, 0) / reqs.length,
    avgServerLatencyMs: serverLats.reduce((a, b) => a + b, 0) / reqs.length,
    minServerLatencyMs: Math.min(...serverLats),
    maxServerLatencyMs: Math.max(...serverLats),
    totalCacheHits: hits,
    totalCacheMisses: misses,
    cacheHitRatio: hits + misses > 0 ? hits / (hits + misses) : 0,
    totalSubgraphRequests: reqs.reduce((a, r) => a + r.subgraphRequests, 0),
    totalBytesTransferred: reqs.reduce((a, r) => a + r.bytesTransferred, 0),
  };
};

// --- Latency chart (inline SVG, no deps) ---

const LatencyChart = ({
  cached,
  uncached,
  iterations,
}: {
  cached: CacheExplorerRequestResult[];
  uncached: CacheExplorerRequestResult[];
  iterations: number;
}) => {
  // Internal viewBox dimensions — the SVG scales to the container width via
  // preserveAspectRatio. Height is a ratio of width for a consistent aspect.
  const width = 800;
  const height = 260;
  // Extra top padding so the legend sits in dedicated headroom above the data.
  const padding = { top: 56, right: 20, bottom: 36, left: 56 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const allValues = [
    ...cached.map((r) => r.serverDurationMs),
    ...uncached.map((r) => r.serverDurationMs),
  ];
  // 15% headroom gives the line some breathing room below the (now reserved)
  // legend area at the very top.
  const maxY = allValues.length > 0 ? Math.max(...allValues) * 1.15 : 10;
  const minY = 0;

  const xForIndex = (i: number) =>
    padding.left + (iterations > 1 ? (i / (iterations - 1)) * plotW : plotW / 2);
  const yForValue = (v: number) =>
    padding.top + plotH - ((v - minY) / (maxY - minY || 1)) * plotH;

  const toPath = (reqs: CacheExplorerRequestResult[]): string =>
    reqs
      .map((r, i) => `${i === 0 ? 'M' : 'L'} ${xForIndex(r.index)} ${yForValue(r.serverDurationMs)}`)
      .join(' ');

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    y: padding.top + plotH - t * plotH,
    value: minY + t * (maxY - minY),
  }));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-auto w-full"
    >
      {/* Grid */}
      {yTicks.map((t, idx) => (
        <g key={idx}>
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={t.y}
            y2={t.y}
            className="stroke-border"
            strokeDasharray="2 2"
          />
          <text
            x={padding.left - 6}
            y={t.y + 4}
            className="fill-muted-foreground text-[10px]"
            textAnchor="end"
          >
            {formatMs(t.value)}
          </text>
        </g>
      ))}
      {/* Axes */}
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={padding.top + plotH}
        y2={padding.top + plotH}
        className="stroke-border"
      />
      <line
        x1={padding.left}
        x2={padding.left}
        y1={padding.top}
        y2={padding.top + plotH}
        className="stroke-border"
      />
      {/* X labels */}
      <text
        x={padding.left}
        y={height - 10}
        className="fill-muted-foreground text-[10px]"
      >
        1
      </text>
      <text
        x={width - padding.right}
        y={height - 10}
        textAnchor="end"
        className="fill-muted-foreground text-[10px]"
      >
        {iterations}
      </text>
      <text
        x={padding.left + plotW / 2}
        y={height - 10}
        textAnchor="middle"
        className="fill-muted-foreground text-[10px]"
      >
        iteration
      </text>
      {/* Uncached line (red) */}
      {uncached.length > 0 && (
        <>
          <path d={toPath(uncached)} fill="none" stroke="rgb(239 68 68)" strokeWidth={2} />
          {uncached.map((r) => (
            <circle
              key={`u-${r.index}`}
              cx={xForIndex(r.index)}
              cy={yForValue(r.serverDurationMs)}
              r={3}
              fill="rgb(239 68 68)"
            />
          ))}
        </>
      )}
      {/* Cached line (green) */}
      {cached.length > 0 && (
        <>
          <path d={toPath(cached)} fill="none" stroke="rgb(34 197 94)" strokeWidth={2} />
          {cached.map((r) => (
            <circle
              key={`c-${r.index}`}
              cx={xForIndex(r.index)}
              cy={yForValue(r.serverDurationMs)}
              r={3}
              fill="rgb(34 197 94)"
            />
          ))}
        </>
      )}
      {/* Legend — horizontal, sits in reserved headroom above the plot */}
      <g transform={`translate(${padding.left}, 16)`}>
        <circle cx="6" cy="10" r="4" fill="rgb(34 197 94)" />
        <text x="16" y="14" className="fill-foreground text-[11px]">
          Cached
        </text>
        <circle cx="86" cy="10" r="4" fill="rgb(239 68 68)" />
        <text x="96" y="14" className="fill-foreground text-[11px]">
          Uncached
        </text>
      </g>
    </svg>
  );
};

// --- Summary table ---

const SummaryTable = ({
  cached,
  uncached,
  cacheRatio,
}: {
  cached: CacheExplorerPhaseResult;
  uncached: CacheExplorerPhaseResult;
  cacheRatio: number;
}) => {
  const latencyReduction =
    uncached.avgServerLatencyMs > 0
      ? (1 - cached.avgServerLatencyMs / uncached.avgServerLatencyMs)
      : 0;
  const bytesReduction =
    uncached.totalBytesTransferred > 0
      ? (1 - cached.totalBytesTransferred / uncached.totalBytesTransferred)
      : 0;

  const rows: Array<{ label: string; cached: string; uncached: string }> = [
    {
      label: 'Server Avg',
      cached: formatMs(cached.avgServerLatencyMs),
      uncached: formatMs(uncached.avgServerLatencyMs),
    },
    {
      label: 'Server Min',
      cached: formatMs(cached.minServerLatencyMs),
      uncached: formatMs(uncached.minServerLatencyMs),
    },
    {
      label: 'Server Max',
      cached: formatMs(cached.maxServerLatencyMs),
      uncached: formatMs(uncached.maxServerLatencyMs),
    },
    {
      label: 'Avg Latency Reduction',
      cached: formatPercent(Math.max(0, latencyReduction)),
      uncached: '—',
    },
    {
      label: 'Client Avg',
      cached: formatMs(cached.avgClientLatencyMs),
      uncached: formatMs(uncached.avgClientLatencyMs),
    },
    {
      label: 'Subgraph Requests',
      cached: String(cached.totalSubgraphRequests),
      uncached: String(uncached.totalSubgraphRequests),
    },
    {
      label: 'Subgraph Cache Ratio',
      cached: formatPercent(cacheRatio),
      uncached: '—',
    },
    {
      label: 'Subgraph → Router Bytes',
      cached: formatBytes(cached.totalBytesTransferred),
      uncached: formatBytes(uncached.totalBytesTransferred),
    },
    {
      label: 'Subgraph → Router Bytes Reduction',
      cached: formatPercent(Math.max(0, bytesReduction)),
      uncached: '—',
    },
  ];

  return (
    <div className="w-full overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-secondary/50">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Metric</th>
            <th className="px-3 py-2 text-right font-medium text-green-600 dark:text-green-400">
              Cached
            </th>
            <th className="px-3 py-2 text-right font-medium text-red-600 dark:text-red-400">
              Uncached
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.label} className={i % 2 === 0 ? 'bg-background' : 'bg-secondary/20'}>
              <td className="px-3 py-1.5 text-muted-foreground">{r.label}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.cached}</td>
              <td className="px-3 py-1.5 text-right font-mono">{r.uncached}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// --- Fetch breakdown (per subgraph) ---
//
// Groups every entity-lookup key seen across the cached phase by the subgraph
// that would serve it, and shows how many of those keys were resolved from
// L1 cache, L2 cache, or required a real HTTP call. Directly answers the
// user's question "which subgraph is caching saving me from calling?"

type MergedSourceBreakdown = {
  sourceName: string;
  totalFetches: number;
  l1Cached: number;
  l2Cached: number;
  httpCalls: number;
};

const FetchBreakdown = ({ requests }: { requests: CacheExplorerRequestResult[] }) => {
  const merged = useMemo<MergedSourceBreakdown[]>(() => {
    const map = new Map<string, MergedSourceBreakdown>();
    for (const r of requests) {
      for (const sb of r.sourceBreakdown) {
        const cur = map.get(sb.sourceName) || {
          sourceName: sb.sourceName,
          totalFetches: 0,
          l1Cached: 0,
          l2Cached: 0,
          httpCalls: 0,
        };
        cur.totalFetches += sb.totalFetches;
        cur.l1Cached += sb.l1Cached;
        cur.l2Cached += sb.l2Cached;
        cur.httpCalls += sb.httpCalls;
        map.set(sb.sourceName, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.sourceName.localeCompare(b.sourceName));
  }, [requests]);

  if (merged.length === 0) return null;

  return (
    <div className="w-full overflow-hidden rounded-md border">
      <div className="bg-secondary/50 px-3 py-2 text-sm font-medium">
        Fetch Breakdown by Subgraph (cached phase)
      </div>
      <table className="w-full text-sm">
        <thead className="bg-secondary/30 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">Subgraph</th>
            <th className="px-3 py-1.5 text-right font-medium">Fetches</th>
            <th className="px-3 py-1.5 text-right font-medium">L1 Cached</th>
            <th className="px-3 py-1.5 text-right font-medium">L2 Cached</th>
            <th className="px-3 py-1.5 text-right font-medium">HTTP</th>
            <th className="px-3 py-1.5 text-right font-medium">Cache Ratio</th>
          </tr>
        </thead>
        <tbody>
          {merged.map((s, i) => {
            const cached = s.l1Cached + s.l2Cached;
            const ratio = s.totalFetches > 0 ? cached / s.totalFetches : 0;
            return (
              <tr
                key={s.sourceName}
                className={i % 2 === 0 ? 'bg-background' : 'bg-secondary/20'}
              >
                <td className="px-3 py-1.5 font-medium text-foreground">{s.sourceName}</td>
                <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                  {s.totalFetches}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                  {s.l1Cached > 0 ? s.l1Cached : '—'}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                  {s.l2Cached > 0 ? s.l2Cached : '—'}
                </td>
                <td
                  className={cn(
                    'px-3 py-1.5 text-right font-mono',
                    s.httpCalls === 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
                  )}
                >
                  {s.httpCalls}
                </td>
                <td
                  className={cn(
                    'px-3 py-1.5 text-right font-mono',
                    ratio === 1 && 'text-green-600 dark:text-green-400',
                    ratio < 1 && ratio > 0 && 'text-yellow-600 dark:text-yellow-400',
                    ratio === 0 && 'text-muted-foreground',
                  )}
                >
                  {formatPercent(ratio)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// --- Fetch plan tree ---

// fetchPlanNodeStatus returns a compact tag describing what happened at a
// single fetch node from a caching perspective. Picked so you can skim the
// tree and immediately see which fetches were real HTTP round-trips, which
// were served from L1 (request-scoped dedup), which were L2 hits, and which
// the router short-circuited for other reasons.
type FetchPlanStatus = {
  label: string;
  className: string;
};

const fetchPlanNodeStatus = (node: FetchPlanNode): FetchPlanStatus | null => {
  // Container nodes have no cache status of their own.
  if (node.kind === 'Sequence' || node.kind === 'Parallel') return null;

  // bodySize>0 means the router actually received a response body from the
  // subgraph → a real HTTP fetch happened. Zero body means the router short-
  // circuited via L1/L2/request-scoped injection, even if loadSkipped is false
  // (load_skipped is set only for @requestScoped injections; entity L2 hits
  // leave it false but still bypass the subgraph).
  const realFetch = node.bodySize > 0 && !node.loadSkipped;

  if (!realFetch) {
    // Short-circuited via cache or request-scoped injection — all green.
    if (node.l1Hits > 0 && node.l2Hits === 0) {
      return { label: 'L1 HIT', className: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40' };
    }
    if (node.l2Hits > 0) {
      return { label: 'L2 HIT', className: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40' };
    }
    return { label: 'SKIPPED', className: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40' };
  }

  // Real HTTP fetch happened.
  if (node.l1Misses > 0 || node.l2Misses > 0) {
    // Cache was checked but missed — red to draw attention.
    return { label: 'CACHE MISS', className: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40' };
  }
  // No cache involved (pass-through field without @entityCache) — neutral blue.
  return { label: 'FETCH', className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/40' };
};

// A leaf fetch is a "real HTTP fetch" only if the router actually called the
// subgraph. We use bodySize>0 as the definitive signal: the router only reports
// a response body size when a real HTTP response came back from the subgraph.
// L1/L2 cache hits have bodySize=0 even when loadSkipped=false, because the
// response was synthesized from cache.
const isRealHttpFetch = (n: FetchPlanNode): boolean => {
  if (n.children.length > 0) return false;
  if (n.loadSkipped) return false;
  return n.bodySize > 0;
};

// Sum of real (non-cached, non-skipped) load durations at every leaf in the tree.
const sumRealLoadMs = (node: FetchPlanNode | undefined): number => {
  if (!node) return 0;
  let total = 0;
  const walk = (n: FetchPlanNode) => {
    if (isRealHttpFetch(n)) total += n.loadDurationMs;
    for (const c of n.children) walk(c);
  };
  walk(node);
  return total;
};

// Count leaf fetches that actually made an HTTP call.
const countRealFetches = (node: FetchPlanNode | undefined): number => {
  if (!node) return 0;
  let count = 0;
  const walk = (n: FetchPlanNode) => {
    if (isRealHttpFetch(n)) count++;
    for (const c of n.children) walk(c);
  };
  walk(node);
  return count;
};

// Render the latency annotation for one side of a fetch node. For real HTTP
// fetches this is the network round-trip time; for L2 cache hits we show the
// L2 Get duration (typically microseconds); for L1 hits we show µs where
// available. Returns null if nothing meaningful to display.
const fetchNodeLatency = (node: FetchPlanNode): string | null => {
  if (isRealHttpFetch(node)) {
    return formatMs(node.loadDurationMs);
  }
  // L2 hit: cache_trace carries the actual Get duration
  if (node.l2Hits > 0 && node.l2GetDurationMs > 0) {
    return formatMs(node.l2GetDurationMs);
  }
  // L1 hit or skipped: the cache_trace's own duration field (duration_nanoseconds)
  // captures the combined coordinate/L1 lookup cost — fall back to that via the
  // loadDurationMs synthesized in buildFetchPlan (which uses cache_trace's
  // duration when loadSkipped + no HTTP).
  if (node.loadDurationMs > 0 && node.loadDurationMs < 5) {
    return formatMs(node.loadDurationMs);
  }
  return null;
};

// --- Path hierarchy model ---
//
// Rather than mirroring the router's raw Sequence/Parallel fetch tree, we
// reorganize the plan around *paths*: every distinct response path in the
// query becomes a node in a trie, and the actual fetches (leaf nodes from
// the raw tree) hang off the path node that owns them. This matches how a
// user thinks about their query ("at `recommendedArticles.relatedArticles`,
// what fetches happen?") and avoids showing the same path on every line.
//
// The internal Sequence/Parallel grouping is dropped entirely — it's a
// scheduling detail the user doesn't need to see. Similarly, we collapse
// Single / Entity / BatchEntity into a generic "Fetch" since from the
// caching perspective they all behave identically.

// splitPath breaks a router path string into human-readable segments. The
// router uses `.` as a separator and `@` to denote list flattening. We keep
// `@.foo` glued together into a single segment because the `@` on its own
// isn't meaningful to the reader.
const splitPath = (p: string): string[] => {
  if (!p) return [];
  const parts = p.split('.');
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '@' && i + 1 < parts.length) {
      out.push('@.' + parts[i + 1]);
      i++;
    } else {
      out.push(parts[i]);
    }
  }
  return out;
};

type PathNode = {
  segment: string;      // display segment at this level (e.g. "recommendedArticles", "@.relatedArticles")
  fullPath: string;     // full router path represented by this node
  fetches: FetchPair[]; // fetches that resolve to exactly this path
  children: PathNode[]; // deeper paths nested under this one
};

// Build a path-trie from the collected fetches. Each trie node owns a single
// segment of the path and the fetches that resolve to its full path.
const buildPathTrie = (entries: Array<{ path: string; pair: FetchPair }>): PathNode => {
  const root: PathNode = { segment: '', fullPath: '', fetches: [], children: [] };
  for (const { path, pair } of entries) {
    const segments = splitPath(path);
    if (segments.length === 0) {
      root.fetches.push(pair);
      continue;
    }
    let node = root;
    let accumulated = '';
    for (const seg of segments) {
      accumulated = accumulated === '' ? seg.replace(/^@\./, '@.') : accumulated + '.' + seg.replace(/^@\./, '@.');
      // The full path stored in the raw trace uses "foo.@.bar", but we merge
      // `@.` into one segment. Reconstruct the raw path for lookup parity.
      const rawFull = accumulated.replace(/(^|\.)@\./g, '$1@.');
      let child = node.children.find((c) => c.segment === seg);
      if (!child) {
        child = { segment: seg, fullPath: rawFull, fetches: [], children: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.fetches.push(pair);
  }
  return root;
};

// --- Fetch row cell rendering ---
//
// Each fetch row is a 5-column CSS grid so that badges and latency text line
// up perfectly across every row regardless of how long the path/source labels
// get:
//   [Fetch label (1fr) | Cached badge (78px) | Cached latency (60px) |
//    Uncached badge (78px) | Uncached latency (60px)]
// The grid is defined on the row + header together; cells are plain spans
// that fill their assigned column.

const StatusBadge = ({ status, missingLabel }: { status: FetchPlanStatus | null; missingLabel?: string }) => {
  if (!status) {
    return (
      <span className="block truncate rounded border border-dashed border-border/60 px-1.5 py-0.5 text-center text-[10px] font-semibold text-muted-foreground/80">
        {missingLabel || 'no match'}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'block truncate rounded border px-1.5 py-0.5 text-center text-[10px] font-semibold',
        status.className,
      )}
    >
      {status.label}
    </span>
  );
};

const LatencyCell = ({ text }: { text: string | null }) => (
  <span className="block text-right font-mono text-[11px] text-muted-foreground">
    {text || ''}
  </span>
);

// Attempt to pretty-print a GraphQL query string using the official parser.
// Falls back to the raw string if it fails to parse — the router sometimes
// sends internal federation queries that the parser might reject.
const prettyPrintQuery = (q: string): string => {
  try {
    return gqlPrint(gqlParse(q));
  } catch {
    return q;
  }
};

// --- Structural JSON comparison for per-fetch responses ---
//
// The L2 entity cache stores denormalized (post-merge) entities that include
// fields from ALL subgraphs, while the uncached HTTP response contains only
// the fields that the individual subgraph provides. A naive line diff between
// these two would flag every line as different even though caching is correct.
//
// normalizeForComparison compares structurally: for `_entities` responses, it
// extracts each entity and filters the cached entity to only the fields
// present in the uncached entity. This shows whether the values that the
// subgraph actually provides match the cached values, ignoring extra fields
// (which are expected from denormalization).
//
// Returns { cachedNormalized, uncachedNormalized, extraFieldCount } where
// both normalized strings can be diffed line-by-line meaningfully.
const normalizeForComparison = (
  cachedJson: string,
  uncachedJson: string,
): { cachedNorm: string; uncachedNorm: string; extraFields: number } => {
  try {
    const cached = JSON.parse(cachedJson);
    const uncached = JSON.parse(uncachedJson);

    // If both have _entities arrays, compare entity-by-entity
    const cachedEntities = cached?._entities;
    const uncachedEntities = uncached?._entities;
    if (Array.isArray(cachedEntities) && Array.isArray(uncachedEntities)) {
      let extraFields = 0;
      const filteredCached: any[] = [];
      for (let i = 0; i < uncachedEntities.length; i++) {
        const ue = uncachedEntities[i];
        const ce = cachedEntities[i];
        if (ce && ue && typeof ce === 'object' && typeof ue === 'object') {
          const filtered: any = {};
          for (const key of Object.keys(ue)) {
            filtered[key] = ce[key];
          }
          extraFields += Object.keys(ce).length - Object.keys(ue).length;
          filteredCached.push(filtered);
        } else {
          filteredCached.push(ce);
        }
      }
      return {
        cachedNorm: JSON.stringify({ _entities: filteredCached }, null, 2),
        uncachedNorm: JSON.stringify({ _entities: uncachedEntities }, null, 2),
        extraFields: Math.max(0, extraFields),
      };
    }
  } catch {
    // Fall through to raw comparison
  }
  return { cachedNorm: cachedJson, uncachedNorm: uncachedJson, extraFields: 0 };
};

// Context-diff renderer: compares two pretty-printed JSON strings line by
// line. Matching sections are collapsed into "··· N matching lines ···" fold
// markers so diffs are impossible to miss. 2 lines of context are kept around
// each changed region (like `git diff -U2`). When responses are identical,
// just a green "match" banner is shown — no need to render the full body.
const DIFF_CONTEXT = 2;

type DiffChunk =
  | { kind: 'match'; count: number }
  | { kind: 'diff'; cachedLines: string[]; uncachedLines: string[] };

const buildDiffChunks = (a: string[], b: string[]): DiffChunk[] => {
  const maxLen = Math.max(a.length, b.length);
  // Mark which lines differ.
  const differs: boolean[] = [];
  for (let i = 0; i < maxLen; i++) {
    differs.push((a[i] ?? '') !== (b[i] ?? ''));
  }
  // Expand each diff line by DIFF_CONTEXT in both directions to include context.
  const visible = new Uint8Array(maxLen);
  for (let i = 0; i < maxLen; i++) {
    if (differs[i]) {
      for (let j = Math.max(0, i - DIFF_CONTEXT); j <= Math.min(maxLen - 1, i + DIFF_CONTEXT); j++) {
        visible[j] = 1;
      }
    }
  }
  // Build chunks.
  const chunks: DiffChunk[] = [];
  let i = 0;
  while (i < maxLen) {
    if (visible[i]) {
      // Visible region — collect consecutive visible lines.
      const cachedLines: string[] = [];
      const uncachedLines: string[] = [];
      while (i < maxLen && visible[i]) {
        cachedLines.push(a[i] ?? '');
        uncachedLines.push(b[i] ?? '');
        i++;
      }
      chunks.push({ kind: 'diff', cachedLines, uncachedLines });
    } else {
      // Hidden (all-matching) region — count consecutive hidden lines.
      let count = 0;
      while (i < maxLen && !visible[i]) {
        count++;
        i++;
      }
      chunks.push({ kind: 'match', count });
    }
  }
  return chunks;
};

const ResponseDiff = ({
  cachedJson,
  uncachedJson,
}: {
  cachedJson: string;
  uncachedJson: string;
}) => {
  const match = cachedJson === uncachedJson;
  const cachedLines = useMemo(() => cachedJson.split('\n'), [cachedJson]);
  const uncachedLines = useMemo(() => uncachedJson.split('\n'), [uncachedJson]);
  const chunks = useMemo(
    () => buildDiffChunks(cachedLines, uncachedLines),
    [cachedLines, uncachedLines],
  );
  const diffCount = useMemo(
    () => chunks.reduce((n, c) => n + (c.kind === 'diff' ? c.cachedLines.filter((l, i) => l !== c.uncachedLines[i]).length : 0), 0),
    [chunks],
  );
  // When matching: default to showing full response. When differing: default
  // to diff-only (collapsed matching lines). Toggle switches between modes.
  const [showFull, setShowFull] = useState(match);
  const maxLines = Math.max(cachedLines.length, uncachedLines.length);

  const diffClass = {
    green: 'border-l-2 border-green-500 bg-green-500/15 pl-2',
    red: 'border-l-2 border-red-500 bg-red-500/15 pl-2',
  };

  // Render one side of the diff — either collapsed (chunks) or full (all lines).
  const renderSide = (lines: string[], otherLines: string[], color: 'green' | 'red') => {
    if (showFull) {
      return (
        <pre className="whitespace-pre font-mono text-[10px] leading-snug text-foreground">
          <div className="px-3 py-0.5">
            {Array.from({ length: maxLines }, (_, i) => {
              const line = lines[i] ?? '';
              const otherLine = otherLines[i] ?? '';
              const differs = line !== otherLine;
              return (
                <div key={i} className={differs && !match ? diffClass[color] : ''}>
                  {line}
                </div>
              );
            })}
          </div>
        </pre>
      );
    }
    return (
      <pre className="whitespace-pre font-mono text-[10px] leading-snug text-foreground">
        {chunks.map((chunk, ci) =>
          chunk.kind === 'match' ? (
            <div
              key={ci}
              className="border-y border-border/20 bg-secondary/20 px-3 py-0.5 text-center text-[9px] text-muted-foreground"
            >
              ··· {chunk.count} matching lines ···
            </div>
          ) : (
            <div key={ci} className="px-3 py-0.5">
              {(color === 'green' ? chunk.cachedLines : chunk.uncachedLines).map((line, li) => {
                const otherLine = (color === 'green' ? chunk.uncachedLines : chunk.cachedLines)[li];
                const differs = line !== otherLine;
                return (
                  <div key={li} className={differs ? diffClass[color] : ''}>
                    {line}
                  </div>
                );
              })}
            </div>
          ),
        )}
      </pre>
    );
  };

  return (
    <>
      <div
        className={cn(
          'flex items-center justify-between border-y border-border/50 px-3 py-1 text-[9px] font-semibold uppercase tracking-wide',
          match
            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
            : 'bg-red-500/10 text-red-600 dark:text-red-400',
        )}
      >
        <span>
          {match
            ? 'Response — cached and uncached match'
            : `Response — ${diffCount} line${diffCount !== 1 ? 's' : ''} differ`}
        </span>
        <button
          className="rounded border border-current/30 px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal opacity-70 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            setShowFull((v) => !v);
          }}
        >
          {showFull ? 'Show diff only' : 'Show full response'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-0">
        <div className="border-r border-border/30">
          <div className="border-b border-border/30 bg-secondary/40 px-3 py-0.5 text-[9px] font-semibold uppercase text-green-600 dark:text-green-400">
            Cached
          </div>
          {renderSide(cachedLines, uncachedLines, 'green')}
        </div>
        <div>
          <div className="border-b border-border/30 bg-secondary/40 px-3 py-0.5 text-[9px] font-semibold uppercase text-red-600 dark:text-red-400">
            Uncached
          </div>
          {renderSide(uncachedLines, cachedLines, 'red')}
        </div>
      </div>
    </>
  );
};

// Top-level response comparison between the last cached and uncached iterations.
// Shows a side-by-side diff of the full GraphQL response data so users can
// verify cache correctness — if the responses differ, there's a bug.
const ResponseComparison = ({
  cachedResponse,
  uncachedResponse,
}: {
  cachedResponse: any;
  uncachedResponse: any;
}) => {
  const cachedJson = useMemo(
    () => (cachedResponse != null ? JSON.stringify(cachedResponse, null, 2) : ''),
    [cachedResponse],
  );
  const uncachedJson = useMemo(
    () => (uncachedResponse != null ? JSON.stringify(uncachedResponse, null, 2) : ''),
    [uncachedResponse],
  );

  if (!cachedJson && !uncachedJson) return null;

  return (
    <div className="w-full overflow-hidden rounded-md border">
      <div className="bg-secondary/50 px-3 py-2 text-sm font-medium">
        Response Comparison (last measured iteration)
      </div>
      <ResponseDiff cachedJson={cachedJson} uncachedJson={uncachedJson} />
    </div>
  );
};

// Build a compact summary like "2× Article, 1× Query" from raw cache keys.
const summarizeCacheKeys = (keys: string[]): string => {
  const counts = new Map<string, number>();
  for (const raw of keys) {
    let typeName = '?';
    try {
      const jsonStart = raw.indexOf('{');
      if (jsonStart >= 0) {
        const parsed = JSON.parse(raw.slice(jsonStart));
        if (parsed?.__typename) typeName = parsed.__typename;
      }
    } catch { /* keep '?' */ }
    counts.set(typeName, (counts.get(typeName) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([t, n]) => `${n}× ${t}`)
    .join(', ');
};

// CursorTooltip renders a floating card that tracks the cursor position. The
// card's bottom-left corner anchors to the cursor (so the tooltip always
// hovers above-and-right of the pointer). Portaled to document.body so it
// can escape the cache-explorer scroll container and any other ancestor
// with overflow:hidden.
//
// Position updates bypass React state and write directly to the DOM on every
// pointermove for smooth tracking — state-driven updates would trigger a
// re-render per pixel which is wasteful here since nothing else in the
// tooltip changes as the cursor moves.
const CursorTooltip = ({
  visible,
  title,
  body,
  footer,
  tooltipRef,
  cursorPosRef,
}: {
  visible: boolean;
  title: string;
  body: string;
  footer?: string;
  tooltipRef: React.RefObject<HTMLDivElement>;
  cursorPosRef: React.MutableRefObject<{ x: number; y: number }>;
}) => {
  // Apply the initial cursor position synchronously after the portal commits
  // but before paint — this avoids a flash at (0,0) on hover. Subsequent
  // pointermove events update style.left/top directly on the DOM node.
  useLayoutEffect(() => {
    if (!visible) return;
    const el = tooltipRef.current;
    if (!el) return;
    el.style.left = `${cursorPosRef.current.x}px`;
    el.style.top = `${cursorPosRef.current.y}px`;
  }, [visible, tooltipRef, cursorPosRef]);
  if (!visible) return null;
  return createPortal(
    <div
      ref={tooltipRef}
      className="pointer-events-none fixed left-0 top-0 z-[1000] max-w-[720px] -translate-y-full rounded-lg border border-border bg-card text-card-foreground shadow-xl"
    >
      <div className="border-b border-border bg-secondary/50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <pre className="scrollbar-custom max-h-[360px] overflow-auto whitespace-pre px-4 py-3 font-mono text-[11px] leading-snug text-foreground">
        {body}
      </pre>
      {footer && (
        <div className="border-t border-border/50 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
          {footer}
        </div>
      )}
    </div>,
    document.body,
  );
};

const FetchRow = ({ pair }: { pair: FetchPair }) => {
  const ref = pair.cached || pair.uncached!;
  const cachedStatus = pair.cached ? fetchPlanNodeStatus(pair.cached) : null;
  const uncachedStatus = pair.uncached ? fetchPlanNodeStatus(pair.uncached) : null;
  const cachedLatency = pair.cached ? fetchNodeLatency(pair.cached) : null;
  const uncachedLatency = pair.uncached ? fetchNodeLatency(pair.uncached) : null;
  const rawQuery = pair.cached?.query || pair.uncached?.query;
  const formattedQuery = useMemo(
    () => (rawQuery ? prettyPrintQuery(rawQuery) : undefined),
    [rawQuery],
  );
  const rawCacheKeys = pair.cached?.cacheKeys || pair.uncached?.cacheKeys;
  const cacheKeys = useMemo(() => dedupeCacheKeysForDisplay(rawCacheKeys), [rawCacheKeys]);
  const cachedResponseData = pair.cached?.responseData;
  const uncachedResponseData = pair.uncached?.responseData;
  const hasDetail = !!(cacheKeys?.length || formattedQuery || cachedResponseData != null || uncachedResponseData != null);
  const keySummary = useMemo(
    () => (cacheKeys && cacheKeys.length > 0 ? summarizeCacheKeys(cacheKeys) : undefined),
    [cacheKeys],
  );
  const identityLabel = useMemo(
    () => summarizeFetchIdentity(pair.cached) || summarizeFetchIdentity(pair.uncached),
    [pair.cached, pair.uncached],
  );
  // Normalize per-fetch responses for structural comparison. L2 cached
  // entities contain a superset of fields (denormalized from all subgraphs);
  // the uncached response has only this subgraph's fields. Comparing raw JSON
  // would flag every line as different. normalizeForComparison filters the
  // cached entities to only the fields present in the uncached response so
  // the diff shows actual value differences, not structural noise.
  const { cachedNorm, uncachedNorm, extraFields } = useMemo(() => {
    if (cachedResponseData == null || uncachedResponseData == null) {
      return {
        cachedNorm: cachedResponseData != null ? JSON.stringify(cachedResponseData, null, 2) : undefined,
        uncachedNorm: uncachedResponseData != null ? JSON.stringify(uncachedResponseData, null, 2) : undefined,
        extraFields: 0,
      };
    }
    return normalizeForComparison(
      JSON.stringify(cachedResponseData, null, 2),
      JSON.stringify(uncachedResponseData, null, 2),
    );
  }, [cachedResponseData, uncachedResponseData]);

  const tooltipRef = useRef<HTMLDivElement>(null);
  const cursorPosRef = useRef({ x: 0, y: 0 });
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleMove = (e: React.PointerEvent) => {
    cursorPosRef.current = { x: e.clientX, y: e.clientY };
    const el = tooltipRef.current;
    if (!el) return;
    el.style.left = `${e.clientX}px`;
    el.style.top = `${e.clientY}px`;
  };

  const handleEnter = (e: React.PointerEvent) => {
    if (!formattedQuery) return;
    cursorPosRef.current = { x: e.clientX, y: e.clientY };
    setTooltipVisible(true);
  };

  const handleLeave = () => setTooltipVisible(false);

  return (
    <>
      <div
        className={cn(
          'grid grid-cols-[1fr_78px_60px_78px_60px] items-baseline gap-x-2 rounded px-1.5 py-0.5 font-mono text-xs hover:bg-secondary/40',
          hasDetail && 'cursor-pointer',
        )}
        onPointerEnter={handleEnter}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        onClick={hasDetail ? () => setExpanded((v) => !v) : undefined}
      >
        <div className="flex items-baseline gap-x-1.5 truncate">
          <span className="text-muted-foreground">Fetch →</span>
          <span className="text-foreground">{ref.sourceName || '?'}</span>
          {identityLabel && (
            <span className="truncate text-[10px] text-muted-foreground">· {identityLabel}</span>
          )}
        </div>
        <StatusBadge status={cachedStatus} missingLabel="no cached fetch" />
        <LatencyCell text={cachedLatency} />
        <StatusBadge status={uncachedStatus} missingLabel="no uncached fetch" />
        <LatencyCell text={uncachedLatency} />
      </div>
      {/* Inline expandable detail panel — click anywhere on it to fold.
          No internal scrolling — the outer cache-explorer container scrolls. */}
      {expanded && hasDetail && (
        <div
          className="my-1 ml-4 mr-1 cursor-pointer overflow-hidden rounded border border-border/50 bg-secondary/10"
          onClick={() => setExpanded(false)}
        >
          {formattedQuery && (
            <>
              <div className="border-b border-border/50 bg-secondary/30 px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                Query
              </div>
              <pre className="whitespace-pre px-4 py-2 font-mono text-[11px] leading-snug text-foreground">
                {formattedQuery}
              </pre>
            </>
          )}
          {cacheKeys && cacheKeys.length > 0 && (
            <>
              <div className="border-y border-border/50 bg-secondary/30 px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                Cache Keys ({cacheKeys.length})
              </div>
              <pre className="whitespace-pre px-4 py-2 font-mono text-[11px] leading-snug text-foreground">
                {cacheKeys.map(formatCacheKey).join('\n\n')}
              </pre>
            </>
          )}
          {(cachedNorm || uncachedNorm) && (
            <>
              <ResponseDiff
                cachedJson={cachedNorm || '(served from cache — not recorded in trace)'}
                uncachedJson={uncachedNorm || '(no uncached data)'}
              />
              {extraFields > 0 && (
                <div className="px-3 py-1 text-[9px] text-muted-foreground">
                  Cached response has {extraFields} additional field{extraFields !== 1 ? 's' : ''} from
                  other subgraphs (expected — L2 stores denormalized entities).
                  Comparison above shows only the fields this subgraph provides.
                </div>
              )}
            </>
          )}
        </div>
      )}
      {/* Hover tooltip — query + compact key summary */}
      {formattedQuery && (
        <CursorTooltip
          visible={tooltipVisible}
          title={`Fetch → ${ref.sourceName || '?'}`}
          body={formattedQuery}
          footer={keySummary ? `Cache keys: ${keySummary}` : undefined}
          tooltipRef={tooltipRef}
          cursorPosRef={cursorPosRef}
        />
      )}
    </>
  );
};

// Recursively render a path node: its segment header (when it has one) plus
// any fetches at this path, then child paths indented beneath.
const PathTreeNode = ({ node, depth }: { node: PathNode; depth: number }) => {
  const isRoot = node.segment === '';
  return (
    <>
      {!isRoot && (
        <div
          className="py-0.5 font-mono text-xs font-medium text-blue-600 dark:text-blue-400"
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
          {node.segment}
        </div>
      )}
      {node.fetches.length > 0 && (
        <div style={{ paddingLeft: `${(isRoot ? depth : depth + 1) * 16 + 4}px` }}>
          {node.fetches.map((pair, i) => (
            <FetchRow key={i} pair={pair} />
          ))}
        </div>
      )}
      {node.children.map((child, i) => (
        <PathTreeNode key={i} node={child} depth={isRoot ? depth : depth + 1} />
      ))}
    </>
  );
};

const FetchPlanTree = ({
  cachedPlan,
  uncachedPlan,
}: {
  cachedPlan?: FetchPlanNode;
  uncachedPlan?: FetchPlanNode;
}) => {
  // Hooks must come before any early return — React's rules-of-hooks.
  const entries = useMemo(
    () => collectFetchPairs(cachedPlan, uncachedPlan),
    [cachedPlan, uncachedPlan],
  );
  const pathRoot = useMemo(() => buildPathTrie(entries), [entries]);

  if (!cachedPlan && !uncachedPlan) return null;

  const cachedCount = countRealFetches(cachedPlan);
  const uncachedCount = countRealFetches(uncachedPlan);
  const cachedTotal = sumRealLoadMs(cachedPlan);
  const uncachedTotal = sumRealLoadMs(uncachedPlan);

  return (
    <div className="w-full overflow-hidden rounded-md border">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-secondary/50 px-3 py-2 text-sm">
        <span className="font-medium">Fetch Plan (last measured iteration)</span>
        <span className="text-xs text-muted-foreground">
          Cached:{' '}
          <span className="font-mono text-green-600 dark:text-green-400">
            {cachedCount} HTTP · {formatMs(cachedTotal)}
          </span>
          {' · '}
          Uncached:{' '}
          <span className="font-mono text-red-600 dark:text-red-400">
            {uncachedCount} HTTP · {formatMs(uncachedTotal)}
          </span>
        </span>
      </div>
      {/* Column headers — fixed widths match the FetchRow grid columns */}
      <div className="grid grid-cols-[1fr_78px_60px_78px_60px] gap-x-2 border-b bg-secondary/20 px-3 py-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
        <div>Path / Fetch</div>
        <div className="col-span-2 text-center text-green-600 dark:text-green-400">Cached</div>
        <div className="col-span-2 text-center text-red-600 dark:text-red-400">Uncached</div>
      </div>
      <div className="overflow-x-auto p-2">
        <PathTreeNode node={pathRoot} depth={0} />
      </div>
    </div>
  );
};

// --- Speedup banner ---

// Cache ratio: the fraction of entity-lookup keys served from cache (L1 or
// L2) across all subgraphs in the cached phase. This is the same number
// rolled up from the per-subgraph Fetch Breakdown table — it answers
// "what fraction of individual entity lookups did caching resolve without
// hitting a subgraph?"
//
// Per-key rather than per-HTTP-fetch because a single batch fetch resolves
// many entities independently; counting keys gives a truer picture of the
// work saved. For the demo query with 10 iterations: viewer has 150 keys
// (140 cached, 10 HTTP), cachegraph 130 (120 cached, 10 HTTP), cachegraph-ext
// 140 (all cached), summing to 400/420 ≈ 95% cache ratio.
const computeCacheRatio = (requests: CacheExplorerRequestResult[]): number => {
  let totalFetches = 0;
  let cachedFetches = 0;
  for (const r of requests) {
    for (const sb of r.sourceBreakdown) {
      totalFetches += sb.totalFetches;
      cachedFetches += sb.l1Cached + sb.l2Cached;
    }
  }
  return totalFetches > 0 ? cachedFetches / totalFetches : 0;
};

const SpeedupBanner = ({
  speedup,
  cacheRatio,
}: {
  speedup: number;
  cacheRatio: number;
}) => {
  if (!isFinite(speedup) || speedup <= 0) return null;
  const isFaster = speedup > 1;
  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline justify-center gap-x-6 gap-y-1 rounded-md border px-4 py-3 text-center',
        isFaster
          ? 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400'
          : 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400',
      )}
    >
      <span>
        <span className="text-2xl font-bold">{speedup.toFixed(2)}x</span>
        <span className="ml-2 text-sm">
          {isFaster ? 'faster with caching (server-side)' : 'no speedup — cache did not help'}
        </span>
      </span>
      {cacheRatio > 0 && (
        <span>
          <span className="text-2xl font-bold">{Math.round(cacheRatio * 100)}%</span>
          <span className="ml-2 text-sm">cache ratio (entity lookups served from cache)</span>
        </span>
      )}
    </div>
  );
};

// --- Main view ---

export const CacheExplorerView = () => {
  const { cacheMode } = useContext(PlaygroundContext);
  const [iterations, setIterations] = useLocalStorage<number>(
    'playground:cache-explorer:iterations',
    10,
  );
  const [state, setState] = useState<CacheExplorerState>(cacheExplorerController.getState());

  useEffect(() => {
    return cacheExplorerController.subscribe(setState);
  }, []);

  // Expose current iterations + cacheMode to the fetcher intercept via window.
  // The fetcher picks these up when the user clicks play in cache-explorer view.
  useEffect(() => {
    (window as any).__cacheExplorerConfig = { iterations, cacheMode };
  }, [iterations, cacheMode]);

  // Arm the trigger gate when the play button is clicked. We use a capture-phase
  // listener on the execute button so the flag is set BEFORE GraphiQL's fetcher
  // fires. Without this, GraphiQL's auto-refetch on header/query edits would
  // re-launch the benchmark unintentionally.
  useEffect(() => {
    const btn = document.querySelector('button[aria-label^="Execute query"]');
    if (!btn) return;
    const handler = () => {
      (window as any).__cacheExplorerTrigger = true;
    };
    btn.addEventListener('click', handler, { capture: true });
    return () => btn.removeEventListener('click', handler, { capture: true });
  }, []);

  const canRun = cacheMode !== 'disabled';
  const isRunning = state.status === 'running';

  const cachedReqs = useMemo(() => {
    if (state.status === 'running') return state.cachedResults;
    if (state.status === 'complete') return state.result.cached.requests;
    return [];
  }, [state]);

  const uncachedReqs = useMemo(() => {
    if (state.status === 'running') return state.uncachedResults;
    if (state.status === 'complete') return state.result.uncached.requests;
    return [];
  }, [state]);

  const cachedPhase = useMemo(() => {
    if (state.status === 'complete') return state.result.cached;
    return aggregatePartial(cachedReqs);
  }, [state, cachedReqs]);

  const uncachedPhase = useMemo(() => {
    if (state.status === 'complete') return state.result.uncached;
    return { ...aggregatePartial(uncachedReqs), label: 'uncached' as const };
  }, [state, uncachedReqs]);

  const liveSpeedup =
    state.status === 'complete'
      ? state.result.speedup
      : cachedPhase.avgServerLatencyMs > 0 && uncachedPhase.avgServerLatencyMs > 0
        ? uncachedPhase.avgServerLatencyMs / cachedPhase.avgServerLatencyMs
        : 0;

  const liveCacheRatio = useMemo(() => computeCacheRatio(cachedReqs), [cachedReqs]);

  return (
    <div className="scrollbar-custom h-full w-full space-y-4 overflow-y-auto overflow-x-hidden p-4">
      {/* Header */}
      <div className="flex flex-col gap-y-2 rounded-md border bg-secondary/20 p-3">
        <div className="flex items-center gap-x-3">
          <label className="text-sm font-medium">Iterations:</label>
          <input
            type="number"
            min={2}
            max={100}
            value={iterations}
            disabled={isRunning}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!Number.isNaN(v) && v >= 2 && v <= 100) setIterations(v);
            }}
            className="h-8 w-20 rounded border bg-background px-2 text-sm"
          />
          {isRunning && (
            <Button variant="destructive" size="sm" onClick={() => cacheExplorerController.abort()}>
              Cancel
            </Button>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {canRun ? (
            <>
              Comparing: <span className="font-medium text-foreground">{cacheModeLabels[cacheMode]}</span>{' '}
              vs <span className="font-medium text-foreground">Cache disabled</span>
              {!isRunning && state.status !== 'complete' && (
                <span className="ml-2">— click the Play button to run</span>
              )}
            </>
          ) : (
            <span className="flex items-center gap-x-1.5 text-orange-600 dark:text-orange-400">
              <ExclamationTriangleIcon className="h-4 w-4" />
              Select a cache mode other than &quot;Cache disabled&quot; to run the explorer
            </span>
          )}
        </div>
      </div>

      {/* Running progress — single bar from 0% to 100%. Warmup is hidden
          (runs silently between uncached and cached phases). */}
      {isRunning && state.phase !== 'warmup' && (() => {
        const totalWork = state.total * 2;
        const completed = state.phase === 'uncached'
          ? state.current
          : state.total + state.current;
        const pct = Math.min(100, (completed / totalWork) * 100);
        const label = state.phase === 'uncached'
          ? `Uncached phase — request ${state.current} / ${state.total}`
          : `Cached phase — request ${state.current} / ${state.total}`;
        const step = state.phase === 'uncached' ? 'Step 1/2' : 'Step 2/2';
        return (
          <div className="rounded-md border bg-secondary/20 p-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">{label}</span>
              <span className="text-muted-foreground">{step}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })()}

      {/* Error */}
      {state.status === 'error' && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {state.message}
        </div>
      )}

      {/* Empty state */}
      {state.status === 'idle' && (
        <div className="flex items-center justify-center py-16">
          <EmptyState
            icon={<LuActivity />}
            title="Cache Explorer"
            description={
              canRun
                ? 'Write a query in the editor, pick a cache mode, and click the Play button. The explorer will run your query multiple times with caching enabled and again with caching disabled, then compare latencies and cache efficiency side by side.'
                : 'Pick a cache mode other than "Cache disabled" to enable the explorer.'
            }
          />
        </div>
      )}

      {/* Results (also shown live during run) */}
      {(isRunning || state.status === 'complete') && (cachedReqs.length > 0 || uncachedReqs.length > 0) && (
        <>
          {liveSpeedup > 0 && (
            <SpeedupBanner speedup={liveSpeedup} cacheRatio={liveCacheRatio} />
          )}

          <div className="w-full rounded-md border p-3">
            <LatencyChart
              cached={cachedReqs}
              uncached={uncachedReqs}
              iterations={state.status === 'running' ? state.total : iterations}
            />
          </div>

          <SummaryTable cached={cachedPhase} uncached={uncachedPhase} cacheRatio={liveCacheRatio} />

          <FetchBreakdown requests={cachedReqs} />

          <FetchPlanTree
            cachedPlan={cachedReqs.length > 0 ? cachedReqs[cachedReqs.length - 1].fetchPlan : undefined}
            uncachedPlan={uncachedReqs.length > 0 ? uncachedReqs[uncachedReqs.length - 1].fetchPlan : undefined}
          />

          {cachedReqs.length > 0 && uncachedReqs.length > 0 && (
            <ResponseComparison
              cachedResponse={cachedReqs[cachedReqs.length - 1].responseData}
              uncachedResponse={uncachedReqs[uncachedReqs.length - 1].responseData}
            />
          )}

          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-800 dark:text-yellow-300">
            <div className="flex items-start gap-x-2">
              <BoltIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <strong>Note:</strong> The cached phase is preceded by {WARMUP_ITERATIONS}{' '}
                warm-up queries (not shown in results) so the cache is fully populated before
                the measured iterations begin. Other router caches (plan, normalization,
                variables) also warm during warm-up, so the measured iterations focus on
                entity cache impact. This is a dev-mode exploration tool, not a production
                load test.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
