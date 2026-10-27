import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { ProbeRequest, probeRootFields } from './probe';
import { DeferController, initialAnalysis } from './defer-controller';

type Options = {
  query: string;
  routingUrl: string;
  controller: DeferController | null;
  // Called when Analyse is clicked, so the probe uses the current headers and variables.
  getRequest: () => ProbeRequest;
};

// The analysis state lives on the controller, so it survives the panel unmounting. This hook only runs probes.
export const useDeferAdvisor = ({ query, routingUrl, controller, getRequest }: Options) => {
  const subscribe = useCallback((listener: () => void) => controller?.subscribe(listener) ?? (() => {}), [controller]);
  const { latencies, probeFailures, error, running } = useSyncExternalStore(
    subscribe,
    () => controller?.snapshot ?? initialAnalysis,
  );

  // Bumped when the query or URL changes, so a probe of the old input cannot write its numbers onto the new one.
  const runId = useRef(0);

  // The cleanup also runs on unmount. The controller outlives the panel, so a probe
  // still in flight would otherwise write its numbers after the panel is gone.
  const probeAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    controller?.invalidateIfUrlChanged(routingUrl);
  }, [controller, routingUrl]);
  useEffect(() => {
    runId.current += 1;
    controller?.setRunning(false);
    return () => {
      runId.current += 1;
      probeAbort.current?.abort();
    };
  }, [query, routingUrl]);

  const analyse = async () => {
    if (!controller) {
      return;
    }
    const id = ++runId.current;
    const abort = new AbortController();
    probeAbort.current = abort;
    try {
      const request = getRequest();
      controller.startAnalysis(routingUrl, request.variablesError ?? null);
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
      controller.finishAnalysis(measured, failures);
    } catch (err) {
      if (id === runId.current) {
        controller.failAnalysis(err instanceof Error ? err.message : 'Analysis failed');
      }
    }
  };

  const clear = () => controller?.clear();

  return { latencies, probeFailures, error, running, analyse, clear };
};
