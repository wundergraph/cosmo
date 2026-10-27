import { useEffect, useRef, useState } from 'react';
import { ProbeRequest, probeRootFields } from './probe';

type Options = {
  query: string;
  routingUrl: string;
  // Called when Analyse is clicked, so the probe uses the current headers and variables.
  getRequest: () => ProbeRequest;
};

// Everything the panel needs to run and show a probe.
export const useDeferAdvisor = ({ query, routingUrl, getRequest }: Options) => {
  const [latencies, setLatencies] = useState<Record<string, number> | null>(null);
  const [probeFailures, setProbeFailures] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // Bumped when the query or URL changes, so a probe of the old input cannot write its numbers onto the new one.
  const runId = useRef(0);

  // The cleanup also runs on unmount, so a probe still in flight cannot set state on a closed panel.
  const probeAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    runId.current += 1;
    setLatencies(null);
    setProbeFailures({});
    setError(null);
    setRunning(false);
    return () => {
      runId.current += 1;
      probeAbort.current?.abort();
    };
  }, [query, routingUrl]);

  const analyse = async () => {
    const id = ++runId.current;
    const abort = new AbortController();
    probeAbort.current = abort;
    setRunning(true);
    try {
      const request = getRequest();
      setError(request.variablesError ?? null);
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
      setLatencies(measured);
      setProbeFailures(failures);
    } catch (err) {
      if (id === runId.current) {
        setLatencies(null);
        setError(err instanceof Error ? err.message : 'Analysis failed');
      }
    } finally {
      if (id === runId.current) {
        setRunning(false);
      }
    }
  };

  const clear = () => {
    setLatencies(null);
    setProbeFailures({});
    setError(null);
  };

  return { latencies, probeFailures, error, running, analyse, clear };
};
