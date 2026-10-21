export type DeferSuggestion = {
  fieldName: string;
  latencyMs: number;
};

// Deferring a field only lowers TTFB if it is slower than the fastest field.
export const suggestDefers = (latencies: Record<string, number>): DeferSuggestion[] => {
  const fastest = Math.min(...Object.values(latencies));

  return Object.entries(latencies)
    .filter(([, ms]) => ms > fastest)
    .sort((a, b) => b[1] - a[1])
    .map(([fieldName, latencyMs]) => ({ fieldName, latencyMs }));
};

export type TimingSummary = {
  totalMs: number;
  ttfbAfterMs: number;
};

export const summarizeTiming = (latencies: Record<string, number>, deferred: string[]): TimingSummary => {
  const totalMs = Math.max(0, ...Object.values(latencies));
  const immediate = Object.entries(latencies)
    .filter(([name]) => !deferred.includes(name))
    .map(([, ms]) => ms);
  const ttfbAfterMs = immediate.length > 0 ? Math.max(...immediate) : totalMs;

  return { totalMs, ttfbAfterMs };
};
