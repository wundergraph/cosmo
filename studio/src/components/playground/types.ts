export type TraceInfo = {
  startUnixSeconds: number;
};

export type FetchNode = {
  id: string;
  parentId?: string;
  type: string;
  dataSourceId?: string;
  dataSourceName?: string;
  children: FetchNode[];
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
};
