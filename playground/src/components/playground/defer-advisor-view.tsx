import { useContext, useMemo, useState } from 'react';
import { LuCheck, LuLoader2, LuWand2 } from 'react-icons/lu';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { EmptyState } from '../empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { TraceContext } from './trace-view';
import { DeferAdvisorResult } from './types';
import { applyDeferSuggestions } from './defer-advisor-rewrite';

export type DeferAdvisorState = {
  loading: boolean;
  error: string;
  result?: DeferAdvisorResult;
  analyzedQuery: string;
  // The operation the advisor profiled, so Apply rewrites the same one in a
  // multi-operation document.
  operationName?: string;
};

const formatMs = (ms: number) => {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  return `${ms.toFixed(1)} ms`;
};

// setQueryEditorValue writes into GraphiQL's query editor. GraphiQL 3 uses
// CodeMirror 5, which exposes its instance on the wrapper element; setValue
// triggers GraphiQL's own change handlers, so tab state stays consistent.
const setQueryEditorValue = (value: string): boolean => {
  const wrapper = document.querySelector('.graphiql-query-editor .CodeMirror') as {
    CodeMirror?: { setValue: (v: string) => void };
  } | null;
  if (!wrapper?.CodeMirror) {
    return false;
  }
  wrapper.CodeMirror.setValue(value);
  return true;
};

const StatCard = ({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) => (
  <div className={cn('flex flex-col gap-1 rounded-lg border bg-card px-4 py-3', highlight && 'border-success/60')}>
    <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
    <span className={cn('text-2xl font-semibold tabular-nums', highlight && 'text-success')}>{value}</span>
    {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
  </div>
);

export const DeferAdvisorView = ({
  state,
  onAnalyze,
}: {
  state: DeferAdvisorState;
  onAnalyze: (runs: number) => void;
}) => {
  const { query } = useContext(TraceContext);
  const [runs, setRuns] = useState('3');
  const [appliedLabels, setAppliedLabels] = useState<string[]>([]);
  const [applyError, setApplyError] = useState('');
  const [lastWrittenQuery, setLastWrittenQuery] = useState('');

  const { loading, error, result, analyzedQuery } = state;

  // Warn only about edits the user made; queries we wrote via Apply still
  // match the analysis.
  const queryChanged =
    !!result && !!query && query.trim() !== analyzedQuery.trim() && query.trim() !== lastWrittenQuery.trim();

  const maxLatency = useMemo(() => Math.max(1, ...(result?.fields ?? []).map((f) => f.latencyMs.avgMs)), [result]);
  const suggestedPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const s of result?.suggestions ?? []) {
      for (const field of s.fields) {
        paths.add(s.path === '' ? field : `${s.path}.${field}`);
      }
    }
    return paths;
  }, [result]);

  const validationMax = useMemo(() => {
    if (!result?.validation) {
      return 0;
    }
    return Math.max(
      result.validation.initialResponseMs.avgMs,
      ...result.validation.deferredParts.map((p) => p.arrivedAtMs.avgMs),
      1,
    );
  }, [result]);

  const apply = (labels: string[]) => {
    if (!result) {
      return;
    }
    const groups = result.suggestions
      .filter((s) => labels.includes(s.label) && !appliedLabels.includes(s.label))
      .map((s) => ({ path: s.path ?? '', fields: s.fields, label: s.label }));
    if (groups.length === 0 || !query) {
      return;
    }
    try {
      const rewritten = applyDeferSuggestions(query, groups, state.operationName);
      if (!setQueryEditorValue(rewritten)) {
        setApplyError('Could not access the query editor');
        return;
      }
      setApplyError('');
      setLastWrittenQuery(rewritten);
      setAppliedLabels((prev) => [...prev, ...groups.map((g) => g.label)]);
    } catch (e: any) {
      setApplyError(e.message ?? 'Failed to rewrite the operation');
    }
  };

  const analyze = () => {
    setAppliedLabels([]);
    setApplyError('');
    onAnalyze(Number(runs));
  };

  const runsSelect = (
    <Select value={runs} onValueChange={setRuns}>
      <SelectTrigger className="w-[110px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {['1', '2', '3', '5', '10'].map((n) => (
          <SelectItem key={n} value={n}>
            {n} {n === '1' ? 'run' : 'runs'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (loading) {
    return (
      <div className="flex h-full w-full flex-1 items-center justify-center bg-background font-sans">
        <EmptyState
          icon={<LuLoader2 className="animate-spin" />}
          title="Profiling your operation"
          description={`Running the operation ${runs}× with tracing, then ${runs}× with per-field @defer splits to attribute latency to individual fields.`}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full flex-1 items-center justify-center bg-background font-sans">
        <EmptyState
          icon={<ExclamationTriangleIcon className="h-12 w-12" />}
          title="Defer Advisor failed"
          description={error}
          actions={
            <div className="flex items-center gap-x-2">
              {runsSelect}
              <Button onClick={analyze}>Try again</Button>
            </div>
          }
        />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex h-full w-full flex-1 items-center justify-center bg-background font-sans">
        <EmptyState
          icon={<LuWand2 />}
          title="Find out what to @defer"
          description="The router profiles this operation, measures every field's latency (even inside a single subgraph fetch), and suggests where @defer cuts your TTFB. The operation is executed multiple times against real subgraphs."
          actions={
            <div className="flex items-center gap-x-2">
              {runsSelect}
              <Button onClick={analyze} disabled={!query}>
                <LuWand2 className="mr-2" /> Analyze operation
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const baseline = result.totalDurationMs.avgMs;
  const initial = result.validation?.initialResponseMs.avgMs;
  const speedup = initial && initial > 0 ? baseline / initial : undefined;
  const recommended = result.outcome === 'recommended';

  return (
    <div className="scrollbar-custom flex h-full w-full flex-1 flex-col gap-y-5 overflow-auto bg-background p-4 font-sans">
      <div className="flex items-center justify-between gap-x-2">
        <div className="flex items-center gap-x-2">
          <LuWand2 className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Defer Advisor</h2>
          <Badge variant="secondary">{result.runs} runs</Badge>
          <Badge variant={recommended ? 'default' : 'secondary'}>{result.outcome.replace(/_/g, ' ')}</Badge>
          {queryChanged && (
            <Badge variant="destructive">
              <ExclamationTriangleIcon className="mr-1 h-3 w-3" /> query changed since analysis
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-x-2">
          {runsSelect}
          <Button variant="secondary" onClick={analyze}>
            Re-analyze
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="TTFB without @defer" value={formatMs(baseline)} sub="everything in one response" />
        <StatCard
          label="TTFB with @defer"
          value={initial ? formatMs(initial) : '—'}
          sub={result.validation ? `measured across ${result.validation.runs} optimized runs` : 'not validated'}
          highlight={recommended}
        />
        {recommended && speedup && speedup > 1.05 ? (
          <StatCard
            label="TTFB speedup"
            value={`${speedup.toFixed(1)}× faster`}
            sub={`optimized total ${formatMs(result.validation?.totalResponseMs.avgMs ?? 0)}`}
            highlight
          />
        ) : (
          <StatCard label="TTFB speedup" value="—" sub="no significant gain found" />
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Suggestions</h3>
        {result.suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{result.reason ?? 'No actionable defer portfolio was found.'}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {applyError && <p className="text-sm text-destructive">{applyError}</p>}
            {result.suggestions.map((s) => {
              const applied = appliedLabels.includes(s.label);
              return (
                <div
                  key={s.label}
                  className="flex items-center justify-between gap-x-3 rounded-lg border bg-card px-4 py-3"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <code className="text-sm font-medium">
                        {s.fields.map((f) => (s.path ? `${s.path}.${f}` : f)).join(', ')}
                      </code>
                      <Badge variant="secondary">{s.subgraph}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      wrap in <code>... @defer(label: &quot;{s.label}&quot;)</code>
                      {' — validated as part of the complete suggested portfolio'}
                    </span>
                  </div>
                  <Button
                    variant={applied ? 'ghost' : 'default'}
                    size="sm"
                    disabled={applied || queryChanged}
                    onClick={() => apply([s.label])}
                  >
                    {applied ? (
                      <>
                        <LuCheck className="mr-1 text-success" /> Applied
                      </>
                    ) : (
                      'Apply'
                    )}
                  </Button>
                </div>
              );
            })}
            {result.suggestions.length > 1 && (
              <Button
                className="self-end"
                size="sm"
                disabled={queryChanged || result.suggestions.every((s) => appliedLabels.includes(s.label))}
                onClick={() => apply(result.suggestions.map((s) => s.label))}
              >
                Apply all suggestions
              </Button>
            )}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Field latency</h3>
        <div className="flex flex-col gap-1.5">
          {result.fields.map((f) => {
            const suggested = suggestedPaths.has(f.path);
            return (
              <div key={f.path} className="flex items-center gap-x-3">
                <code className="w-64 truncate text-sm" title={f.path}>
                  {f.path}
                </code>
                <Badge variant="secondary" className="w-24 justify-center truncate">
                  {f.subgraph}
                </Badge>
                <div className="h-3 flex-1 overflow-hidden rounded-sm bg-muted">
                  <div
                    className={cn('h-full rounded-sm', suggested ? 'bg-amber-500' : 'bg-emerald-500')}
                    style={{ width: `${Math.max(1.5, (f.latencyMs.avgMs / maxLatency) * 100)}%` }}
                  />
                </div>
                <span className="w-20 text-right text-sm tabular-nums text-muted-foreground">
                  {formatMs(f.latencyMs.avgMs)}
                </span>
              </div>
            );
          })}
          {result.fields.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No per-field data: every measured fetch serves a single field group or the operation has no nested
              fetches.
            </p>
          )}
        </div>
      </div>

      {result.validation && (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Measured delivery with the optimized query
          </h3>
          <div className="flex flex-col gap-1.5">
            {[
              { label: 'TTFB (initial response)', at: result.validation.initialResponseMs.avgMs, initial: true },
              ...result.validation.deferredParts.map((p) => ({
                label: p.label,
                at: p.arrivedAtMs.avgMs,
                initial: false,
              })),
            ].map((part) => (
              <div key={part.label} className="flex items-center gap-x-3">
                <code className="w-64 truncate text-sm" title={part.label}>
                  {part.label}
                </code>
                <div className="relative h-3 flex-1 rounded-sm bg-muted">
                  <div
                    className={cn('absolute h-full rounded-sm', part.initial ? 'bg-success' : 'bg-sky-500')}
                    style={{ width: `${Math.max(1, (part.at / validationMax) * 100)}%` }}
                  />
                </div>
                <span className="w-20 text-right text-sm tabular-nums text-muted-foreground">{formatMs(part.at)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Timings are aggregate measurements from {result.validation.runs} optimized streaming runs; the terminal
            response arrived in {formatMs(result.validation.totalResponseMs.avgMs)} on average.
          </p>
        </div>
      )}
    </div>
  );
};
