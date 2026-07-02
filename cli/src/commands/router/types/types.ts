export interface FetchRouterConfigResult {
  splitConfigLoading: boolean;
  routerConfig: string;
  featureFlags?: Map<string, string>;
  mapper?: Record<string, string>;
}
