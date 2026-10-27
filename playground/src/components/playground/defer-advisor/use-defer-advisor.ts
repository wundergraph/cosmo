import { useEffect, useReducer, useRef } from 'react';
import { ProbeRequest, probeRootFields } from './probe';

type Options = {
  query: string;
  routingUrl: string;
  // Called when Analyse is clicked, so the probe uses the current headers and variables.
  getRequest: () => ProbeRequest;
};

type State = {
  latencies: Record<string, number> | null;
  probeFailures: Record<string, string>;
  error: string | null;
  running: boolean;
};

type Action =
  | { type: 'started'; variablesError: string | null }
  | { type: 'succeeded'; latencies: Record<string, number>; probeFailures: Record<string, string> }
  | { type: 'failed'; message: string }
  | { type: 'cleared' }
  | { type: 'reset' };

const initialState: State = { latencies: null, probeFailures: {}, error: null, running: false };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'started':
      return { ...state, running: true, error: action.variablesError };
    case 'succeeded':
      return { ...state, latencies: action.latencies, probeFailures: action.probeFailures, running: false };
    case 'failed':
      return { ...state, latencies: null, error: action.message, running: false };
    case 'cleared':
      return { ...state, latencies: null, probeFailures: {}, error: null };
    case 'reset':
      return initialState;
  }
};

// Everything the panel needs to run and show a probe.
export const useDeferAdvisor = ({ query, routingUrl, getRequest }: Options) => {
  const [{ latencies, probeFailures, error, running }, dispatch] = useReducer(reducer, initialState);
  // Bumped when the query or URL changes, so a probe of the old input cannot write its numbers onto the new one.
  const runId = useRef(0);

  // The cleanup also runs on unmount, so a probe still in flight cannot set state on a closed panel.
  const probeAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    runId.current += 1;
    dispatch({ type: 'reset' });
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
      dispatch({ type: 'started', variablesError: request.variablesError ?? null });
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
      dispatch({ type: 'succeeded', latencies: measured, probeFailures: failures });
    } catch (err) {
      if (id === runId.current) {
        dispatch({ type: 'failed', message: err instanceof Error ? err.message : 'Analysis failed' });
      }
    }
  };

  const clear = () => dispatch({ type: 'cleared' });

  return { latencies, probeFailures, error, running, analyse, clear };
};
