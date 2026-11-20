import { AnalyticsViewFilterOperator } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { z } from 'zod';
import type { AnalyticsWindow } from '../window.js';

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

/** The window as the metrics RPCs take it: hours in `range`, or an explicit `dateRange`. */
export function metricsWindow(window: AnalyticsWindow) {
  return window.dateRange ? { dateRange: window.dateRange } : { range: window.range };
}

/** The window as Studio's analytics pages read it from the URL. */
export function studioWindowParams(window: AnalyticsWindow): Record<string, string> {
  return window.dateRange ? { dateRange: JSON.stringify(window.dateRange) } : { range: String(window.range) };
}
