import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Kind } from 'graphql';
import { Button } from '../../ui/button';
import { slowFieldNames } from './analysis';
import { applyDefer, listDeferLabels, makeUniqueLabel, revertDefer } from './defer-transform';
import { getOperation, parseQuery } from './operation';
import { probeRootFields, ProbeRequest } from './probe';
import type { PillController } from './pills-controller';
import { summarizeRootFields } from './root-field-summary';

type Props = {
  query: string;
  routingUrl: string;
  // Called when Analyse is clicked, so the probe uses the current headers and variables.
  getRequest: () => ProbeRequest;
  onQueryChange: (query: string) => void;
  controller: PillController | null;
};

export const DeferAdvisorPanel = ({ query, routingUrl, getRequest, onQueryChange, controller }: Props) => {
  const subscribe = useCallback((listener: () => void) => controller?.subscribe(listener) ?? (() => {}), [controller]);
  const latencies = useSyncExternalStore(subscribe, () => controller?.latencies ?? null);

  const [probeFailures, setProbeFailures] = useState<Record<string, string>>({});
  const [variablesError, setVariablesError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // Bumped when the query or URL changes, so a probe of the old input cannot write its numbers onto the new one.
  const runId = useRef(0);

  // The cleanup also runs on unmount. The controller outlives the panel, so a probe
  // still in flight would otherwise write its numbers after the panel is gone.
  const probeAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    runId.current += 1;
    setRunning(false);
    return () => {
      runId.current += 1;
      probeAbort.current?.abort();
    };
  }, [query, routingUrl]);

  const parsed = useMemo(() => parseQuery(query), [query]);
  const doc = parsed?.doc;
  const operation = useMemo(() => getOperation(doc), [doc]);
  const operationCount = doc?.definitions.filter((d) => d.kind === Kind.OPERATION_DEFINITION).length ?? 0;
  const isMutationOrSubscription = operation?.operation === 'mutation' || operation?.operation === 'subscription';
  // A comment-only document fails to parse but has nothing to fix.
  const hasSyntaxError = doc === undefined && !query.split('\n').every((line) => /^\s*(#.*)?$/.test(line));

  const rows = useMemo(() => summarizeRootFields(parsed), [parsed]);

  const slowNames = useMemo(() => (latencies ? slowFieldNames(latencies) : new Set<string>()), [latencies]);

  const analyse = async () => {
    if (!controller) {
      return;
    }
    const id = ++runId.current;
    const abort = new AbortController();
    probeAbort.current = abort;
    setRunning(true);
    try {
      const request = getRequest();
      setVariablesError(request.variablesError ?? null);
      const results = await probeRootFields(routingUrl, query, request, abort.signal);
      if (id !== runId.current) {
        return;
      }
      const measured: Record<string, number> = {};
      const failures: Record<string, string> = {};
      for (const [name, result] of Object.entries(results)) {
        if (result.ok) {
          measured[name] = result.latencyMs;
        } else {
          failures[name] = result.reason;
        }
      }
      controller.setLatencies(measured);
      setProbeFailures(failures);
    } catch {
      if (id === runId.current) {
        controller.setLatencies(null);
      }
    } finally {
      if (id === runId.current) {
        setRunning(false);
      }
    }
  };

  const clear = () => {
    controller?.setLatencies(null);
    setProbeFailures({});
  };

  const deferField = (name: string) => {
    if (!parsed) {
      return;
    }
    const label = makeUniqueLabel(name, new Set(listDeferLabels(parsed)));
    onQueryChange(applyDefer(parsed, name, label));
  };

  const revertLabel = (label: string) => {
    if (!parsed) {
      return;
    }
    onQueryChange(revertDefer(parsed, label));
  };

  const emptyNotice =
    query.trim() === '' ? 'Write a query to see its root fields here.' : 'No root fields to show here.';

  const canAnalyse = !!controller && !running && rows.length > 0;

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-auto p-4">
      <div className="flex items-center gap-2">
        <span className="font-semibold">Defer Advisor</span>
        {!isMutationOrSubscription && !hasSyntaxError && (
          <div className="ml-auto flex gap-2">
            <Button onClick={analyse} disabled={!canAnalyse}>
              {running ? 'Analysing...' : latencies ? 'Re-analyse' : 'Analyse operation'}
            </Button>
            {latencies && (
              <Button variant="secondary" onClick={clear} disabled={running}>
                Clear
              </Button>
            )}
          </div>
        )}
      </div>

      {isMutationOrSubscription ? (
        <p className="text-muted-foreground text-sm">
          Defer only works on read-only queries. Mutations and subscriptions are not changed.
        </p>
      ) : hasSyntaxError ? (
        <p className="text-muted-foreground text-sm">Fix the syntax error to see the root fields here.</p>
      ) : (
        <>
          {operationCount > 1 && (
            <p className="text-muted-foreground text-sm">
              This document has {operationCount} operations. Defer only reads the first one.
            </p>
          )}

          {variablesError && <p className="text-destructive text-sm">{variablesError}</p>}

          {latencies && Object.keys(probeFailures).length > 0 && (
            <div className="rounded border border-destructive/40 p-3 text-sm">
              <div className="font-medium">Some fields could not be probed</div>
              {Object.entries(probeFailures).map(([name, reason]) => (
                <div key={name} className="text-muted-foreground font-mono text-xs">
                  {name}: {reason}
                </div>
              ))}
            </div>
          )}

          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{emptyNotice}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map(({ name, undeferred, deferredLabels, eagerLabels }) => {
                const latency = latencies?.[name];
                return (
                  <div key={name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded border p-3">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm">{name}</div>
                      {latency !== undefined && (
                        <div className="text-muted-foreground text-xs">
                          {latency}ms{slowNames.has(name) ? ' · slow' : ''}
                        </div>
                      )}
                      {deferredLabels.map((label) => (
                        <div key={label} className="truncate font-mono text-xs">{`@defer(label: "${label}")`}</div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      {undeferred > 0 && (
                        <Button size="sm" className="whitespace-nowrap" onClick={() => deferField(name)}>
                          Defer
                        </Button>
                      )}
                      {eagerLabels.map((label) => (
                        <Button
                          key={label}
                          variant="secondary"
                          size="sm"
                          className="whitespace-nowrap"
                          onClick={() => revertLabel(label)}
                        >
                          {eagerLabels.length > 1 ? `Eager ${label}` : 'Eager'}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {latencies && Object.keys(latencies).length > 0 && rows.length > 0 && slowNames.size === 0 && (
            <p className="text-muted-foreground text-sm">No slow fields found. Nothing to defer.</p>
          )}
        </>
      )}
    </div>
  );
};
