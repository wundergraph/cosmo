// Deferring a field only lowers TTFB if it is slower than the fastest field.
export const slowFieldNames = (latencies: Record<string, number>): Set<string> => {
  const fastest = Math.min(...Object.values(latencies));
  return new Set(
    Object.entries(latencies)
      .filter(([, ms]) => ms > fastest)
      .map(([name]) => name),
  );
};
