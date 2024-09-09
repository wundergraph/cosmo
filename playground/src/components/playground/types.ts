export type LoadStatsEntry = {
  name: string;
  durationSinceStart: string;
  idleTime?: string;
  attributes: Record<string, any>;
};

export type LoadStats = LoadStatsEntry[];

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
  query: string;
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
  children: QueryPlanFetchTypeNode[];
};
