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

export type PlaygroundView = 'response' | 'request-trace' | 'query-plan';

export type CacheMode = 'enabled' | 'no-l1' | 'no-l2' | 'disabled';

type PlaygroundContextType = {
  graphId: string;
  tabsState: TabsState;
  status?: number;
  statusText?: string;
  view: PlaygroundView;
  setView: (val: PlaygroundView) => void;
  cacheMode: CacheMode;
  setCacheMode: (val: CacheMode) => void;
};

export const PlaygroundContext = createContext<PlaygroundContextType>({
  graphId: '',
  tabsState: { tabs: [], activeTabIndex: 0 },
  view: 'response',
  setView: () => {},
  cacheMode: 'enabled',
  setCacheMode: () => {},
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

export type CacheTrace = {
  l1Enabled: boolean;
  l2Enabled: boolean;
  cacheName: string;
  ttlSeconds: number;
  entityCount: number;
  l1Hit: number;
  l1Miss: number;
  l2Hit: number;
  l2Miss: number;
  durationSinceStart?: number;
  durationSinceStartPretty?: string;
  duration?: number;
  durationPretty?: string;
  l2GetDurationPretty?: string;
  l2SetDurationPretty?: string;
  keys?: string[];
};

export type CacheStatus = 'l1-hit' | 'l2-hit' | 'miss' | 'no-lookup';

export const getCacheStatus = (ct: CacheTrace): CacheStatus => {
  if (ct.l1Hit > 0) return 'l1-hit';
  if (ct.l2Hit > 0) return 'l2-hit';
  if (ct.l1Miss > 0 || ct.l2Miss > 0) return 'miss';
  return 'no-lookup';
};

export const getCacheStatusLabel = (ct: CacheTrace): string => {
  const status = getCacheStatus(ct);
  switch (status) {
    case 'l1-hit': return 'L1 HIT';
    case 'l2-hit': return 'L2 HIT';
    case 'miss': return 'MISS';
    case 'no-lookup': return 'NO LOOKUP';
  }
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
  cacheTrace?: CacheTrace;
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
};

export type QueryPlan = QueryPlanFetchTypeNode & {
  version: string;
  trigger?: QueryPlanFetchNode;
  children: QueryPlanFetchTypeNode[];
};
