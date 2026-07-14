type RawTraceNode = Record<string, any>;

const finiteNonNegative = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

export const traceNodeHasTiming = (node: RawTraceNode | undefined) => {
  const trace = node?.trace ?? node?.datasource_load_trace;
  return (
    finiteNonNegative(trace?.duration_since_start_nanoseconds) !== undefined ||
    finiteNonNegative(trace?.duration_load_nanoseconds) !== undefined
  );
};

export const traceNodeIsPlannedOnly = (node: RawTraceNode | undefined, inherited = false) =>
  inherited || node?.defer?.status === 'skipped';

export const traceNodeChildren = (node: RawTraceNode | undefined): RawTraceNode[] => {
  const children = node?.fetches ?? node?.children ?? node?.traces;
  return Array.isArray(children) ? children : [];
};

export const tracePhaseEndNanoseconds = (stats: RawTraceNode | undefined) =>
  (finiteNonNegative(stats?.duration_since_start_nanoseconds) ?? 0) +
  (finiteNonNegative(stats?.duration_nanoseconds) ?? 0);

export const traceDurationNanoseconds = (trace: RawTraceNode | undefined) => {
  let duration = 0;
  const info = trace?.info;
  for (const phase of ['parse_stats', 'normalize_stats', 'validate_stats', 'planner_stats']) {
    duration = Math.max(duration, tracePhaseEndNanoseconds(info?.[phase]));
  }

  const visit = (node: RawTraceNode | undefined) => {
    if (!node) {
      return;
    }
    const loadTrace = node.trace ?? node.datasource_load_trace;
    const start = finiteNonNegative(loadTrace?.duration_since_start_nanoseconds);
    const load = finiteNonNegative(loadTrace?.duration_load_nanoseconds);
    if (start !== undefined || load !== undefined) {
      duration = Math.max(duration, (start ?? 0) + (load ?? 0));
    }
    for (const child of traceNodeChildren(node)) {
      visit(child.fetch ?? child);
    }
  };
  visit(trace?.fetches?.fetch ?? trace?.fetches);
  return duration;
};
