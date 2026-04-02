import { createContext, ReactNode } from 'react';

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

type PlaygroundContextType = {
  graphId: string;
  tabsState: TabsState;
  status?: number;
  statusText?: string;
  view: PlaygroundView;
  setView: (val: PlaygroundView) => void;
};

export const PlaygroundContext = createContext<PlaygroundContextType>({
  graphId: '',
  tabsState: { tabs: [], activeTabIndex: 0 },
  view: 'response',
  setView: () => {},
});

/**
 * Playground extension system types
 */

// Context passed to extension render functions and hooks
export type PlaygroundExtensionContext = {
  query?: string;
  setQuery: (query: string) => void;
  variables?: string;
  setVariables: (variables: string) => void;
  headers?: string;
  setHeaders: (headers: string) => void;
  response?: string;
  view: PlaygroundView;
  setView: (view: PlaygroundView) => void;
  status?: number;
  statusText?: string;
  schema?: any;
};

// Lifecycle hooks for extensions
export type PlaygroundExtensionHooks = {
  /**
   * Called when the query changes
   */
  onQueryChange?: (query: string | undefined, context: PlaygroundExtensionContext) => void;

  /**
   * Called when the variables change
   */
  onVariablesChange?: (variables: string | undefined, context: PlaygroundExtensionContext) => void;

  /**
   * Called when the headers change
   */
  onHeadersChange?: (headers: string | undefined, context: PlaygroundExtensionContext) => void;

  /**
   * Called when a response is received
   */
  onResponseReceived?: (response: string, context: PlaygroundExtensionContext) => void;

  /**
   * Called when the extension mounts
   */
  onMount?: (context: PlaygroundExtensionContext) => void;

  /**
   * Called when the extension unmounts
   */
  onUnmount?: () => void;

  /**
   * Called when the view changes
   */
  onViewChange?: (view: PlaygroundView, context: PlaygroundExtensionContext) => void;

  /**
   * Called when the schema changes
   */
  onSchemaChange?: (schema: any, context: PlaygroundExtensionContext) => void;
};

// Panel extension (adds a new tab in the sidebar via GraphiQL plugins)
export type PanelExtension = {
  type: 'panel';
  id: string;
  title: string;
  render: (context: PlaygroundExtensionContext) => ReactNode;
  hooks?: PlaygroundExtensionHooks;
  /** Whether this panel should be visible by default when the playground loads */
  visibleByDefault?: boolean;
};

export type PlaygroundExtension = PanelExtension;

/**
 * Playground configuration types
 */

export type GraphiQLScripts = {
  transformHeaders?: (headers: Record<string, string>) => Record<string, string>;
};

export type PlaygroundProps = {
  /** The GraphQL endpoint URL. If not provided, it will be inferred from the current URL. */
  routingUrl?: string;
  /** Whether to hide the WunderGraph logo in the sidebar */
  hideLogo?: boolean;
  /** Force a specific theme (light or dark) */
  theme?: 'light' | 'dark' | undefined;
  /** Custom scripts for header transformation */
  scripts?: GraphiQLScripts;
  /** Extensions to enhance playground functionality */
  extensions?: PlaygroundExtension[];
};

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
