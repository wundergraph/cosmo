import { createContext } from 'react';

type TabState = {
  id: string;
  hash: string;
  title: string;
  operationName: string | null;
  response: string | null;
  query: string | null;
  variables?: string | null;
  headers?: string | null;
};

export type TabsState = {
  tabs: TabState[];
  activeTabIndex: number;
};

export type PlaygroundView = 'response' | 'request-trace' | 'query-plan' | 'defer-advisor';

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

type PlaygroundContextType = {
  graphId: string;
  tabsState: TabsState;
  status?: number;
  statusText?: string;
  requestTiming?: import('./use-playground-execution').RequestTiming;
  inlineAdvisorEnabled?: boolean;
  setInlineAdvisorEnabled?: (enabled: boolean) => void;
  view: PlaygroundView;
  setView: (val: PlaygroundView) => void;
};

export const PlaygroundContext = createContext<PlaygroundContextType>({
  graphId: '',
  tabsState: { tabs: [], activeTabIndex: 0 },
  view: 'response',
  setView: () => {},
});

export type PlaygroundScript = {
  id: string;
  type: string;
  title: string;
  content: string;
  updatedByTabId?: string;
};

export type LoadStatsEntry = {
  name: string;
  durationSinceStart: string;
  idleTime?: string;
  attributes: Record<string, any>;
};

export type LoadStats = LoadStatsEntry[];

export type DeferExecutionStatus = 'planned' | 'running' | 'completed' | 'error' | 'skipped';

export type DeferDescriptor = {
  id: number;
  label: string;
  path: string[];
  status?: DeferExecutionStatus;
};

export type ARTFetchNode = {
  id: string;
  parentId?: string;
  type: string;
  dataSourceId?: string;
  dataSourceName?: string;
  children: ARTFetchNode[];
  input?: any;
  rawInput?: any;
  output?: any;
  outputTrace?: {
    request: {
      method: string;
      url: string;
      headers: Record<string, Array<string>>;
    };
    response: {
      statusCode: number;
      headers: Record<string, Array<string>>;
    };
  };
  durationSinceStart?: number;
  durationSinceStartPretty?: string;
  durationLoad?: number;
  durationLoadPretty?: string;
  singleFlightUsed: boolean;
  singleFlightSharedResponse: boolean;
  loadSkipped: boolean;
  loadStats?: LoadStats;
  defer?: DeferDescriptor;
  plannedOnly?: boolean;
  executionTracePresent?: boolean;
};

export type Representation = {
  kind: string;
  typeName: string;
  fragment: string;
  fieldName?: string;
};

export type QueryPlanFetchNode = {
  kind: string;
  subgraphName: string;
  subgraphId: string;
  query?: string;
  path?: string;
  representations?: Representation[];
};

export type QueryPlanFetchTypeNode = {
  kind: string;
  fetch?: QueryPlanFetchNode;
  children?: QueryPlanFetchTypeNode[];
  defer?: Omit<DeferDescriptor, 'status'>;
};

export type QueryPlan = QueryPlanFetchTypeNode & {
  version: string;
  trigger?: QueryPlanFetchNode;
  children: QueryPlanFetchTypeNode[];
};
