import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { ProbeRequest, probeRootFields } from './probe';
import { useDefer } from './defer-context';

type Options = {
  query: string;
  routingUrl: string;
  // Called when Analyse is clicked, so the probe uses the current headers and variables.
  getRequest: () => ProbeRequest;
};

export const useDeferAdvisor = ({ query, routingUrl, getRequest }: Options) => {
  const store = useDefer();
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const { latencies, probeFailures, error, running } = useSyncExternalStore(subscribe, () => store.snapshot);

  // Bumped when the query or URL changes, so a probe of the old input cannot write its numbers onto the new one.
  const runId = useRef(0);

  // The cleanup also runs on unmount. The store outlives the panel, so a probe
  // still in flight would otherwise write its numbers after the panel is gone.
  const probeAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    store.invalidateIfUrlChanged(routingUrl);
  }, [store, routingUrl]);
  useEffect(() => {
    runId.current += 1;
    store.setRunning(false);
    return () => {
      runId.current += 1;
      probeAbort.current?.abort();
    };
  }, [query, routingUrl]);

  const analyse = async () => {
    const id = ++runId.current;
    const abort = new AbortController();
    probeAbort.current = abort;
    try {
      const request = getRequest();
      store.startAnalysis(routingUrl, request.variablesError ?? null);
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
      store.finishAnalysis(measured, failures);
    } catch (err) {
      if (id === runId.current) {
        store.failAnalysis(err instanceof Error ? err.message : 'Analysis failed');
      }
    }
  };

  const clear = () => store.clear();

  return { latencies, probeFailures, error, running, analyse, clear };
};
