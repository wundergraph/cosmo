import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ProbeRequest, probeRootFields } from './probe';
import type { PillController } from './pills-controller';

type Options = {
  query: string;
  routingUrl: string;
  controller: PillController | null;
  // Called when Analyse is clicked, so the probe uses the current headers and variables.
  getRequest: () => ProbeRequest;
};

// Everything the panel needs to run and show a probe. The latencies live on the controller,
// so they survive the panel unmounting; the rest is local to the panel.
export const useDeferAdvisor = ({ query, routingUrl, controller, getRequest }: Options) => {
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

  return { latencies, probeFailures, variablesError, running, analyse, clear };
};
