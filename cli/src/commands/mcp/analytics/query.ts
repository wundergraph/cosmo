import {
  AnalyticsOperator,
  type AnalyticsQueryMeta,
  type AnalyticsViewRow,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { z } from 'zod';
import type { Meta } from './envelope.js';
import { parseWindow } from './window.js';

export const OPERATORS = {
  eq: AnalyticsOperator.EQ,
  neq: AnalyticsOperator.NEQ,
  in: AnalyticsOperator.IN,
  not_in: AnalyticsOperator.NOT_IN,
  gt: AnalyticsOperator.GT,
  gte: AnalyticsOperator.GTE,
  lt: AnalyticsOperator.LT,
  lte: AnalyticsOperator.LTE,
  contains: AnalyticsOperator.CONTAINS,
  starts_with: AnalyticsOperator.STARTS_WITH,
  exists: AnalyticsOperator.EXISTS,
} as const;

const scalar = z.union([z.string(), z.number(), z.boolean()]);

/** A row filter: a dimension (or `attr:<key>`), an operator and a value (`in`/`not_in` take `values`). */
export const filterInput = z.object({
  field: z.string().describe('A dimension of the dataset, or attr:<key> for any span attribute.'),
  operator: z.enum(Object.keys(OPERATORS) as [keyof typeof OPERATORS, ...(keyof typeof OPERATORS)[]]).default('eq'),
  value: scalar.optional().describe('The value, for every operator except in, not_in and exists.'),
  values: z.array(scalar).optional().describe('The values, for in and not_in.'),
});
export type FilterInput = z.infer<typeof filterInput>;

export function toPredicate(filter: FilterInput) {
  const values =
    filter.operator === 'exists' ? [] : (filter.values ?? (filter.value === undefined ? [] : [filter.value]));
  return { field: filter.field, operator: OPERATORS[filter.operator], values: values.map(String) };
}

/** A graph reference list from the tool input: one graph, several, or every readable graph. */
export const graphsInput = {
  graph: z.string().optional().describe('Name of one graph. Use graphs or allGraphs to compare several.'),
  namespace: z.string().default('default').describe('Namespace of `graph`.'),
  graphs: z
    .array(z.object({ name: z.string(), namespace: z.string().default('default') }))
    .optional()
    .describe('Several graphs.'),
  allGraphs: z.boolean().optional().describe('Every graph you can read (organization-wide questions).'),
};

export function toGraphRefs(input: {
  graph?: string;
  namespace: string;
  graphs?: { name: string; namespace: string }[];
  allGraphs?: boolean;
}) {
  if (input.allGraphs) {
    return { graphs: [], allReadableGraphs: true };
  }
  const graphs = [...(input.graph ? [{ name: input.graph, namespace: input.namespace }] : []), ...(input.graphs ?? [])];
  if (graphs.length === 0) {
    throw new Error('Name a graph (graph and namespace), several (graphs), or set allGraphs.');
  }
  return { graphs, allReadableGraphs: false };
}

/** The tool's range or from/to as the RPC's window. */
export function toTimeWindow(input: { range?: string; from?: string; to?: string }) {
  const window = parseWindow(input);
  return window.dateRange ? { start: window.dateRange.start, end: window.dateRange.end } : { rangeHours: window.range };
}

/** Rows of an analytics result as plain objects, in column order. */
export function rowsToObjects(rows: AnalyticsViewRow[], columns: string[]) {
  return rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column, row.value[column]?.kind.value ?? null])),
  );
}

/** The server's provenance for a result, as the envelope's meta. */
export function serverMeta(
  meta: AnalyticsQueryMeta | undefined,
  extra: { now: string; studioUrl?: string; warnings?: string[] },
): Meta {
  return {
    dataset: meta?.dataset,
    graphs: meta?.graphs.map((g) => ({ name: g.name, namespace: g.namespace })),
    completeness: meta?.completeness === 'sampled' ? 'sampled' : 'complete',
    observedSamplingRatio: meta?.observedSamplingRatio,
    requestedWindow: meta?.requestedWindow
      ? { start: meta.requestedWindow.start, end: meta.requestedWindow.end }
      : undefined,
    effectiveWindow: meta?.effectiveWindow
      ? { start: meta.effectiveWindow.start, end: meta.effectiveWindow.end }
      : undefined,
    baselineWindow: meta?.baselineWindow
      ? { start: meta.baselineWindow.start, end: meta.baselineWindow.end }
      : undefined,
    granularity: meta?.granularity,
    now: meta?.now || extra.now,
    truncated: meta?.truncated,
    nextCursor: meta?.nextCursor,
    tables: meta?.tables.length ? meta.tables : undefined,
    appliedFilters: meta?.appliedFilters.length ? meta.appliedFilters : undefined,
    warnings: [...(meta?.warnings ?? []), ...(extra.warnings ?? [])],
    studioUrl: extra.studioUrl,
  };
}

export const nsToMs = (value: bigint | number) => Number(value) / 1_000_000;
export const msToNs = (value: number) => BigInt(Math.round(value * 1_000_000));

export const MAX_VALUE_LENGTH = 2048;

/** Long telemetry values are cut to protect the model's context; `full` returns them whole. */
export function truncateValue(value: string, full: boolean): { value: string; truncated: boolean } {
  if (full || value.length <= MAX_VALUE_LENGTH) {
    return { value, truncated: false };
  }
  return { value: value.slice(0, MAX_VALUE_LENGTH), truncated: true };
}
