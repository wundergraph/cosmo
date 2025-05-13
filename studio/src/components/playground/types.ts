import { SHARE_OPTIONS } from "@/lib/constants";
import { createContext } from "react";
import { z } from 'zod';

export type TabState = {
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

export type PlaygroundView = "response" | "request-trace" | "query-plan";

type PlaygroundContextType = {
  graphId: string;
  tabsState: TabsState;
  status?: number;
  statusText?: string;
  view: PlaygroundView;
  setView: (val: PlaygroundView) => void;
  isHydrated: boolean;
  setIsHydrated: (v: boolean) => void;
};

export const PlaygroundContext = createContext<PlaygroundContextType>({
  graphId: "",
  tabsState: { tabs: [], activeTabIndex: 0 },
  view: "response",
  setView: () => {},
  isHydrated: false,
  setIsHydrated: () => {},
});

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

export type ShareOptionId = typeof SHARE_OPTIONS[number]["id"];

export const PlaygroundStateSchema = z.object({
    operation: z.string().min(1, 'Operation is required in playground url state'),
    variables: z.string().optional(),
    headers: z.string().optional(),
    preFlight: z.object({
        enabled: z.boolean().optional(),
        content: z.string().optional(),
        id: z.string().optional(),
        title: z.string().optional(),
        updatedByTabId: z.string().optional(),
        type: z.string().optional(),
    }).optional(),
    preOperation: z.object({
        enabled: z.boolean().optional(),
        content: z.string().optional(),
        id: z.string().optional(),
        title: z.string().optional(),
        updatedByTabId: z.string().optional(),
    }).optional(),
    postOperation: z.object({
        enabled: z.boolean().optional(),
        content: z.string().optional(),
        id: z.string().optional(),
        title: z.string().optional(),
        updatedByTabId: z.string().optional(),
    }).optional(),
});
  
export type PlaygroundUrlState = z.infer<typeof PlaygroundStateSchema>;
export type PreFlightUrlState = PlaygroundUrlState['preFlight'];
export type PreOperationUrlState = PlaygroundUrlState['preOperation'];
export type PostOperationUrlState = PlaygroundUrlState['postOperation'];