// Shape of `extensions.deferAdvisor` returned by an advisor-capable router.
// Mirrors the standalone @wundergraph/playground package's type so the copied
// defer-inline / defer-advisor-rewrite modules behave identically in Studio.

export type DeferAdvisorStat = {
  avgMs: number;
  minMs: number;
  maxMs: number;
};

export type DeferAdvisorResult = {
  outcome: 'recommended' | 'no_candidates' | 'no_gain' | 'regression' | 'inconclusive' | 'unvalidated';
  reason?: string;
  runs: number;
  totalDurationMs: DeferAdvisorStat;
  fetches: {
    fetchId: number;
    subgraph: string;
    path?: string;
    dependsOn?: number[];
    durationMs: DeferAdvisorStat;
    fields: string[];
  }[];
  fields: {
    path: string;
    subgraph: string;
    latencyMs: DeferAdvisorStat;
  }[];
  suggestions: {
    label: string;
    path?: string;
    subgraph: string;
    fields: string[];
  }[];
  optimizedQuery?: string;
  validation?: {
    runs: number;
    initialResponseMs: DeferAdvisorStat;
    totalResponseMs: DeferAdvisorStat;
    initialResponseSavingMs: DeferAdvisorStat;
    deferredParts: {
      label: string;
      arrivedAtMs: DeferAdvisorStat;
    }[];
  };
};
