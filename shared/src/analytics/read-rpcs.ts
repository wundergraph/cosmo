/**
 * The only platform RPCs the analytics MCP toolset may call. All are reads: none writes to Postgres, ClickHouse or
 * blob storage, or triggers webhooks. The CLI narrows its client to this list; the controlplane's handlers for these
 * RPCs skip the API key's last-use update for MCP requests and apply the MCP rate limit, and a controlplane test
 * calls each of them with spies on every write path.
 */
export const ANALYTICS_READ_RPCS = [
  'getAnalyticsCapabilities',
  'getDashboardAnalyticsView',
  'getGraphMetrics',
  'getMetricsErrorRate',
  'getSubgraphMetrics',
  'getSubgraphMetricsErrorRate',
  'getOperations',
  'getOperationContent',
  'getOperationClients',
  'getOperationDeprecatedFields',
  'getFieldUsage',
  'getTrace',
  'getAnalyticsView',
  'getRouters',
  'getOrganizationRequestsCount',
  'getChecksByFederatedGraphName',
  'getCheckSummary',
  'getCheckOperations',
  'getFederatedGraphByName',
  'whoAmI',
  'searchTraces',
  'queryAnalytics',
  'getAnalyticsDimensionValues',
  'getCompositions',
  'getFederatedGraphChangelog',
  'getClients',
] as const;

export type AnalyticsReadRpc = (typeof ANALYTICS_READ_RPCS)[number];
