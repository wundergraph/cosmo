import { AnalyticsViewFilterOperator } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { z } from 'zod';

/* Helpers for the older metrics RPCs behind Studio's analytics pages: graph, subgraph, operation and field metrics. */

export const metricsFilterInput = {
  operationName: z.string().optional().describe('Only this operation.'),
  operationHash: z.string().optional().describe('Only the operation with this hash.'),
  clientName: z.string().optional().describe('Only this client (graphql-client-name header).'),
  clientVersion: z.string().optional().describe('Only this client version.'),
};

/** Equality filters for the metrics RPCs, one per given value. */
export function metricsFilters(input: {
  operationName?: string;
  operationHash?: string;
  clientName?: string;
  clientVersion?: string;
}) {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([field, value]) => ({ field, value: String(value), operator: AnalyticsViewFilterOperator.EQUALS }));
}
