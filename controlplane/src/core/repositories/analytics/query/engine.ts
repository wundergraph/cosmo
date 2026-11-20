import type { ClickHouseClient } from '../../../clickhouse/index.js';
import type { ClickHouseParamValue } from '../../../clickhouse/params.js';
import { traced } from '../../../tracing.js';
import { SamplingRatioRepository } from '../SamplingRatioRepository.js';
import {
  compileQuery,
  excludesIntrospection,
  tenantPredicate,
  TIME_BUCKET_DIMENSION,
  windowPredicates,
  type CompiledColumn,
  type CompiledQuery,
  type CompileInput,
  type VirtualValues,
} from './compiler.js';
import type { AnalyticsInventory, CompositionInfo } from './inventory.js';
import type { PhysicalDataset } from './registry.js';
import type { ValidatedQuery } from './validate.js';
import { formatRows, rowsOverBudget } from './budget.js';
import { QueryBudgetError, QueryValidationError } from './errors.js';
import { grainSecondsOf, parseInstant, toIso, type Window } from './window.js';

export interface EngineGraph {
  id: string;
  name: string;
  namespace: string;
}

export interface EngineScope {
  organizationId: string;
  graphs: EngineGraph[];
  window: Window;
  /** The oldest instant the plan's retention allows for this dataset (Unix seconds); a compare baseline stays after it. */
  retentionStart: number;
}

export type EngineValue = string | number | boolean | null;
export type EngineRow = Record<string, EngineValue>;

export interface EngineResult {
  columns: string[];
  rows: EngineRow[];
  truncated: boolean;
  warnings: string[];
  tables: string[];
  appliedFilters: string[];
  observedSamplingRatio?: number;
  baselineWindow?: Window;
}

/** Groups fetched at most for queries that sort or merge in memory (compare, includeInactive). */
const IN_MEMORY_CAP = 5000;

const PERCENTILE = /^(latency|planning)P\d+$/;
const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

/** Columns that virtual dimensions add next to the ID they group by. */
const EXTRA_COLUMNS: Record<string, string[]> = {
  graph: ['graphNamespace'],
  subgraph: ['subgraphId'],
  composition: ['compositionCreatedAt', 'compositionFeatureFlag'],
};

@traced
export class AnalyticsQueryEngine {
  constructor(
    private client: ClickHouseClient,
    private inventory: AnalyticsInventory,
    private options: { rowBudget: number },
  ) {}

  async run(query: ValidatedQuery, scope: EngineScope, offset: number): Promise<EngineResult> {
    const virtual = await this.virtualValues(query.physical, query, scope);
    const warnings = this.warnings(query);
    const inMemory = Boolean(query.compare) || query.includeInactive;

    const compileInput = (window: Window, limit: number, pageOffset: number): CompileInput => ({
      dataset: query.physical,
      database: this.client.database,
      dimensions: query.dimensions,
      measures: query.measures,
      filters: query.filters,
      having: query.having,
      timeBucketSeconds: query.timeBucketSeconds,
      orderBy: compiledOrder(query),
      limit,
      offset: pageOffset,
      rpmMinutes: (query.timeBucketSeconds ?? Math.max(window.end - window.start, 60)) / 60,
      scope: {
        organizationId: scope.organizationId,
        graphIds: scope.graphs.map((g) => g.id),
        start: window.start,
        end: window.end,
      },
      virtual,
    });

    const current = compileQuery(
      compileInput(scope.window, inMemory ? IN_MEMORY_CAP + 1 : query.limit + 1, inMemory ? 0 : offset),
    );
    const baselineWindow = query.compare ? this.baselineWindow(query, scope, warnings) : undefined;
    const baselineQuery = baselineWindow ? compileQuery(compileInput(baselineWindow, IN_MEMORY_CAP + 1, 0)) : undefined;
    await this.checkBudget(query.physical, current, 'query');
    if (baselineQuery) {
      await this.checkBudget(query.physical, baselineQuery, 'baseline');
    }
    let rows = await this.execute(current, scope);
    let truncated = false;

    if (inMemory) {
      if (rows.length > IN_MEMORY_CAP) {
        rows = rows.slice(0, IN_MEMORY_CAP);
        warnings.push(`Only the first ${IN_MEMORY_CAP} groups were compared; add filters to narrow the query.`);
      }
      if (query.includeInactive) {
        rows = await this.addInactiveRows(query, scope, rows);
      }
      if (baselineQuery) {
        rows = mergeComparison(query, rows, await this.execute(baselineQuery, scope));
      }
      rows = sortRows(rows, query);
      truncated = rows.length > offset + query.limit;
      rows = rows.slice(offset, offset + query.limit);
    } else if (rows.length > query.limit) {
      truncated = true;
      rows = rows.slice(0, query.limit);
    }

    if (rows.some((row) => Object.entries(row).some(([k, v]) => k.startsWith('requestsOver:') && v === null))) {
      warnings.push(
        'requestsOver is exact only at histogram bucket bounds (e.g. 100, 250, 500, 1000, 2500, 5000, 10000 ms); null means the value is not a bound.',
      );
    }

    const sampling =
      query.descriptor.completeness === 'sampled'
        ? await new SamplingRatioRepository(this.client).observe(
            { organizationId: scope.organizationId, graphIds: scope.graphs.map((g) => g.id), window: scope.window },
            this.options.rowBudget,
          )
        : {};
    if (sampling.warning) {
      warnings.push(sampling.warning);
    }

    return {
      columns: this.columnNames(query, rows),
      rows,
      truncated,
      warnings,
      tables: current.tables,
      appliedFilters: describeFilters(query, scope),
      observedSamplingRatio: sampling.ratio,
      baselineWindow,
    };
  }

  /** Values of one dimension with counts, for discovery and autocomplete. */
  async dimensionValues(input: {
    query: ValidatedQuery;
    dimension: string;
    prefix?: string;
    scope: EngineScope;
    limit: number;
  }): Promise<{ values: { value: string; count: number }[]; tables: string[] }> {
    const { query, dimension, scope, prefix, limit } = input;
    const type = query.descriptor.dimensions.find((d) => d.name === dimension)?.type ?? 'string';
    if (prefix && type !== 'string') {
      throw new QueryValidationError(`prefix only applies to text dimensions; ${dimension} is ${type}.`);
    }
    const virtual = await this.virtualValues(query.physical, { ...query, dimensions: [dimension] }, scope);
    const count = query.physical.countMeasure;
    // Virtual values are names resolved after the query, so their prefix is applied to every group before the limit.
    const resolvedLater = Boolean(query.physical.dimensions[dimension]?.virtual);
    const filters =
      prefix && !resolvedLater
        ? [
            ...query.filters,
            { field: dimension, operator: 'starts_with' as const, values: [prefix], type: 'string' as const },
          ]
        : query.filters;
    const compiled = compileQuery({
      dataset: query.physical,
      database: this.client.database,
      dimensions: [dimension],
      measures: [count],
      filters,
      having: [],
      orderBy: [{ field: count, desc: true }],
      limit: prefix && resolvedLater ? IN_MEMORY_CAP : limit,
      offset: 0,
      rpmMinutes: 1,
      scope: {
        organizationId: scope.organizationId,
        graphIds: scope.graphs.map((g) => g.id),
        start: scope.window.start,
        end: scope.window.end,
      },
      virtual,
    });
    await this.checkBudget(query.physical, compiled, 'query');
    const rows = await this.execute(compiled, scope);
    let values = rows.map((row) => ({ value: String(row[dimension] ?? ''), count: Number(row[count] ?? 0) }));
    if (prefix && resolvedLater) {
      values = values.filter((entry) => entry.value.startsWith(prefix)).slice(0, limit);
    }
    return { values, tables: compiled.tables };
  }

  private async virtualValues(
    physical: PhysicalDataset,
    query: Pick<ValidatedQuery, 'dimensions' | 'filters' | 'includeInactive'>,
    scope: EngineScope,
  ): Promise<VirtualValues> {
    const uses = (kind: string) =>
      query.dimensions.some((d) => physical.dimensions[d]?.virtual === kind) ||
      query.filters.some((f) => physical.dimensions[f.field]?.virtual === kind);
    const virtual: VirtualValues = {
      flagVersions: [],
      flagNames: [],
      flagVersionsByName: {},
      subgraphIdsByName: {},
      organizationSubgraphIds: [],
    };
    if (uses('featureFlag')) {
      const versions = await this.inventory.featureFlagVersions(scope.graphs.map((g) => g.id));
      for (const { version, flagName } of versions) {
        virtual.flagVersions.push(version);
        virtual.flagNames.push(flagName);
        (virtual.flagVersionsByName[flagName] ??= []).push(version);
      }
    }
    if (uses('subgraph') || physical.subgraphKeyColumn) {
      const subgraphs = await this.inventory.organizationSubgraphs();
      for (const subgraph of subgraphs) {
        virtual.organizationSubgraphIds.push(subgraph.id);
        (virtual.subgraphIdsByName[subgraph.name] ??= []).push(subgraph.id);
      }
    }
    return virtual;
  }

  private async checkBudget(physical: PhysicalDataset, compiled: CompiledQuery, what: 'query' | 'baseline') {
    if (!physical.rowBudget) {
      return;
    }
    const rows = await rowsOverBudget(this.client, compiled, this.options.rowBudget);
    if (rows !== undefined) {
      throw new QueryBudgetError(
        `${what === 'query' ? 'This query' : 'The comparison baseline'} would read about ${formatRows(rows)} sampled rows (limit ${formatRows(this.options.rowBudget)}). Narrow the window (e.g. 6h) or add a filter such as operationName or spanName.`,
      );
    }
  }

  /**
   * The window a comparison reads: the period of the same length just before the window (whole buckets of the
   * dataset's grain, ending one second before the window starts), or the given baseline. Cut to the plan's retention.
   */
  private baselineWindow(query: ValidatedQuery, scope: EngineScope, warnings: string[]): Window {
    const grain = grainSecondsOf(query.descriptor.grain);
    const snap = (seconds: number) => Math.floor(seconds / grain) * grain;
    const compare = query.compare!;
    let window: Window;
    if (compare.previousPeriod) {
      const { start, end } = scope.window;
      window = { start: snap(start - (end - start) - 1), end: start - 1 };
    } else {
      const start = parseInstant(compare.baselineStart!, 'baselineStart');
      const end = parseInstant(compare.baselineEnd!, 'baselineEnd');
      if (start > end) {
        throw new QueryValidationError('baselineStart is after baselineEnd.');
      }
      window = { start, end };
    }
    if (window.end < scope.retentionStart) {
      throw new QueryValidationError(
        "The baseline is outside your plan's retention; use a shorter window or a baseline inside retention.",
      );
    }
    if (window.start < scope.retentionStart) {
      window = { start: snap(scope.retentionStart), end: window.end };
      warnings.push(
        `The baseline was cut to your plan's retention: it covers ${toIso(window.start)} to ${toIso(window.end)}, which is shorter than the current window.`,
      );
    }
    return window;
  }

  private async execute(compiled: CompiledQuery, scope: EngineScope): Promise<EngineRow[]> {
    const raw = await this.client.queryPromise<Record<string, unknown>>(compiled.sql, compiled.params);
    if (!Array.isArray(raw)) {
      return [];
    }
    const graphs = new Map(scope.graphs.map((g) => [g.id, g]));
    const compositionColumn = compiled.columns.find((c) => c.name === 'composition');
    // Router config versions of compositions are UUIDs; anything else (e.g. an empty version) has no composition.
    const versions = compositionColumn
      ? [...new Set(raw.map((row) => String(row[compositionColumn.alias] ?? '')))].filter((v) => UUID.test(v))
      : [];
    const compositions =
      versions.length > 0 ? await this.inventory.compositions(versions) : new Map<string, CompositionInfo>();
    const subgraphColumn = compiled.columns.find((c) => c.name === 'subgraph');
    const subgraphNames = subgraphColumn
      ? new Map((await this.inventory.organizationSubgraphs()).map((s) => [s.id, s.name]))
      : new Map<string, string>();

    return raw.map((source) => {
      const row: EngineRow = {};
      for (const column of compiled.columns) {
        const value = source[column.alias];
        row[column.name] = convert(column, value);
        switch (column.name) {
          case 'graph': {
            const graph = graphs.get(String(value));
            row.graph = graph?.name ?? String(value);
            row.graphNamespace = graph?.namespace ?? null;

            break;
          }
          case 'subgraph': {
            row.subgraph = subgraphNames.get(String(value)) ?? String(value);
            row.subgraphId = String(value);

            break;
          }
          case 'composition': {
            const info = compositions.get(String(value));
            row.compositionCreatedAt = info?.createdAt ?? null;
            row.compositionFeatureFlag = info?.featureFlag ?? null;

            break;
          }
          // No default
        }
      }
      return row;
    });
  }

  private async addInactiveRows(query: ValidatedQuery, scope: EngineScope, rows: EngineRow[]) {
    const dimension = query.dimensions[0];
    let members: EngineRow[];
    if (dimension === 'graph') {
      members = scope.graphs.map((g) => ({ graph: g.name, graphNamespace: g.namespace }));
    } else if (dimension === 'subgraph') {
      const subgraphs = await this.inventory.graphSubgraphs(scope.graphs.map((g) => g.id));
      members = subgraphs.map((s) => ({ subgraph: s.name, subgraphId: s.id }));
    } else {
      const versions = await this.inventory.featureFlagVersions(scope.graphs.map((g) => g.id));
      members = ['', ...new Set(versions.map((v) => v.flagName))].map((name) => ({ featureFlag: name }));
    }
    const present = new Set(rows.map((row) => JSON.stringify(identity(dimension, row))));
    const zero = Object.fromEntries(
      query.measures.map((m) => [m, query.descriptor.measures.find((d) => d.name === m)?.unit === 'count' ? 0 : null]),
    );
    const missing = members.filter((member) => !present.has(JSON.stringify(identity(dimension, member))));
    return [...rows, ...missing.map((member) => ({ ...member, ...zero }))];
  }

  private warnings(query: ValidatedQuery): string[] {
    const warnings: string[] = [];
    if (query.measures.some((m) => PERCENTILE.test(m))) {
      warnings.push('Latency percentiles come from histograms capped at 10s: values at or above it read as 10000ms.');
    }
    if (query.dimensions.some((d) => query.physical.dimensions[d]?.array && d !== 'attributeKeys')) {
      warnings.push(
        'Grouping by an array dimension counts a row once per element (e.g. once per possible parent type).',
      );
    }
    return warnings;
  }

  private columnNames(query: ValidatedQuery, rows: EngineRow[]): string[] {
    const names: string[] = [];
    for (const dimension of query.dimensions) {
      names.push(dimension, ...(EXTRA_COLUMNS[dimension] ?? []));
    }
    names.push(...query.measures);
    if (query.compare) {
      for (const measure of query.measures) {
        if (rows.some((row) => typeof row[`${measure}Baseline`] === 'number' || row[`${measure}Baseline`] === null)) {
          names.push(`${measure}Baseline`, `${measure}Delta`, `${measure}DeltaPct`);
        }
      }
    }
    return names;
  }
}

/** The requested order, or by default the first measure, largest first (a time series is ordered by time). */
function compiledOrder(query: ValidatedQuery) {
  const order = query.orderBy.filter(
    (sort) => query.measures.includes(sort.field) || query.dimensions.includes(sort.field),
  );
  if (order.length === 0 && !query.timeBucketSeconds) {
    return [{ field: query.measures[0], desc: true }];
  }
  return order;
}

function convert(column: CompiledColumn, value: unknown): EngineValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (column.name === TIME_BUCKET_DIMENSION || column.kind === 'datetime') {
    const seconds = Number(value);
    return seconds > 0 ? toIso(seconds) : null;
  }
  if (column.kind === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (column.kind === 'boolean') {
    return value === true || value === 1 || value === '1' || value === 'true';
  }
  return String(value);
}

/** What a row stands for: a graph by namespace and name, a subgraph by ID (names repeat across namespaces). */
function identity(dimension: string, row: EngineRow): EngineValue | EngineValue[] {
  switch (dimension) {
    case 'graph': {
      return [row.graphNamespace ?? null, row.graph ?? null];
    }
    case 'subgraph': {
      return row.subgraphId ?? null;
    }
    default: {
      return row[dimension] ?? null;
    }
  }
}

function dimensionKey(query: ValidatedQuery, row: EngineRow) {
  return JSON.stringify(query.dimensions.map((d) => identity(d, row)));
}

function mergeComparison(query: ValidatedQuery, current: EngineRow[], baseline: EngineRow[]): EngineRow[] {
  const baselineByKey = new Map(baseline.map((row) => [dimensionKey(query, row), row]));
  const currentKeys = new Set(current.map((row) => dimensionKey(query, row)));
  // Groups that only exist in the baseline (e.g. an operation that stopped receiving traffic) stay visible with 0.
  const onlyBaseline = baseline
    .filter((row) => !currentKeys.has(dimensionKey(query, row)))
    .map((row) => {
      const copy: EngineRow = { ...row };
      for (const measure of query.measures) {
        copy[measure] = typeof row[measure] === 'number' ? 0 : null;
      }
      return copy;
    });
  const merged = [...current, ...onlyBaseline].map((row) => {
    const base = baselineByKey.get(dimensionKey(query, row));
    const out: EngineRow = { ...row };
    for (const measure of query.measures) {
      const now = row[measure];
      const before = base ? base[measure] : null;
      if (typeof now !== 'number' && typeof before !== 'number') {
        continue;
      }
      const a = typeof now === 'number' ? now : 0;
      const b = typeof before === 'number' ? before : 0;
      out[`${measure}Baseline`] = typeof before === 'number' ? before : 0;
      out[`${measure}Delta`] = Math.round((a - b) * 1000) / 1000;
      out[`${measure}DeltaPct`] = b === 0 ? null : Math.round(((a - b) / b) * 10_000) / 100;
    }
    return out;
  });
  const minVolume = query.compare?.minVolume;
  if (minVolume === undefined) {
    return merged;
  }
  const first = query.measures[0];
  return merged.filter((row) => {
    const a = Number(row[first] ?? 0);
    const b = Number(row[`${first}Baseline`] ?? 0);
    return Math.max(a, b) >= minVolume;
  });
}

function sortRows(rows: EngineRow[], query: ValidatedQuery): EngineRow[] {
  const sorts = query.orderBy.length > 0 ? query.orderBy : [{ field: query.measures[0], desc: true }];
  return [...rows].sort((left, right) => {
    for (const sort of sorts) {
      const a = left[sort.field];
      const b = right[sort.field];
      if (a === b) {
        continue;
      }
      // Nulls last in either direction.
      if (a === null || a === undefined) {
        return 1;
      }
      if (b === null || b === undefined) {
        return -1;
      }
      const order = a < b ? -1 : 1;
      return sort.desc ? -order : order;
    }
    return dimensionKey(query, left) < dimensionKey(query, right) ? -1 : 1;
  });
}

function describeFilters(query: ValidatedQuery, scope: EngineScope): string[] {
  const described = query.filters.map(
    (filter) => `${filter.field} ${filter.operator}${filter.values.length > 0 ? ` ${filter.values.join(', ')}` : ''}`,
  );
  if (excludesIntrospection(query.physical, query.filters)) {
    described.push('introspection excluded');
  }
  described.push(`graphs: ${scope.graphs.map((g) => `${g.namespace}/${g.name}`).join(', ')}`);
  return described;
}
