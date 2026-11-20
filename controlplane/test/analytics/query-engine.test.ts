import { describe, expect, test } from 'vitest';
import type { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import {
  AnalyticsQueryEngine,
  type EngineGraph,
  type EngineScope,
} from '../../src/core/repositories/analytics/query/engine.js';
import type { AnalyticsInventory } from '../../src/core/repositories/analytics/query/inventory.js';
import { validateQuery, type AnalyticsQueryRequest } from '../../src/core/repositories/analytics/query/validate.js';
import { QueryBudgetError, QueryValidationError } from '../../src/core/repositories/analytics/query/errors.js';
import { fakeClickHouse } from './fake-clickhouse.js';

const inventory = (overrides: Partial<AnalyticsInventory> = {}): AnalyticsInventory => ({
  featureFlagVersions: () => Promise.resolve([]),
  organizationSubgraphs: () => Promise.resolve([]),
  graphSubgraphs: () => Promise.resolve([]),
  compositions: () => Promise.resolve(new Map()),
  ...overrides,
});

const query = (request: Partial<AnalyticsQueryRequest> & { dataset: string }) =>
  validateQuery({
    dimensions: [],
    measures: [],
    filters: [],
    having: [],
    orderBy: [],
    includeInactive: false,
    ...request,
  });

const prod: EngineGraph = { id: 'g-prod', name: 'main', namespace: 'prod' };
const staging: EngineGraph = { id: 'g-staging', name: 'main', namespace: 'staging' };
const dev: EngineGraph = { id: 'g-dev', name: 'main', namespace: 'dev' };
const alpha: EngineGraph = { id: 'g-alpha', name: 'alpha', namespace: 'default' };
const beta: EngineGraph = { id: 'g-beta', name: 'beta', namespace: 'default' };

const scopeOf = (graphs: EngineGraph[], window?: { start: number; end: number }, retentionStart = 0): EngineScope => ({
  organizationId: 'org-1',
  graphs,
  window: window ?? { start: 30_000, end: 33_750 },
  retentionStart,
});

const engineWith = (client: ClickHouseClient, overrides: Partial<AnalyticsInventory> = {}) =>
  new AnalyticsQueryEngine(client, inventory(overrides), { rowBudget: 1_000_000 });

/** The dataset query of a run, without the sampling-ratio queries a sampled dataset adds. */
const datasetQueries = (queries: { sql: string; params: Record<string, unknown> }[], alias: string) =>
  queries.filter((q) => q.sql.includes(` AS ${alias}`));

describe('Comparisons', () => {
  test('match graphs by namespace as well as by name', async () => {
    const { client } = fakeClickHouse((_, params) =>
      params.start === 30_000
        ? [
            { d_graph: 'g-prod', m_requests: '100' },
            { d_graph: 'g-staging', m_requests: '10' },
          ]
        : [
            { d_graph: 'g-prod', m_requests: '50' },
            { d_graph: 'g-staging', m_requests: '5' },
          ],
    );

    const result = await engineWith(client).run(
      query({
        dataset: 'operation_metrics',
        dimensions: ['graph'],
        measures: ['requests'],
        compare: { previousPeriod: true },
      }),
      scopeOf([prod, staging]),
      0,
    );

    expect(result.rows).toEqual([
      {
        graph: 'main',
        graphNamespace: 'prod',
        requests: 100,
        requestsBaseline: 50,
        requestsDelta: 50,
        requestsDeltaPct: 100,
      },
      {
        graph: 'main',
        graphNamespace: 'staging',
        requests: 10,
        requestsBaseline: 5,
        requestsDelta: 5,
        requestsDeltaPct: 100,
      },
    ]);
  });

  test('compare with the whole buckets just before the window, without overlapping it', async () => {
    const { client, queries } = fakeClickHouse();

    const result = await engineWith(client).run(
      query({
        dataset: 'operation_metrics',
        dimensions: ['operationName'],
        measures: ['requests'],
        compare: { previousPeriod: true },
      }),
      scopeOf([prod]),
      0,
    );

    expect(queries.map((q) => [q.params.start, q.params.end])).toEqual([
      [30_000, 33_750],
      [26_100, 29_999],
    ]);
    expect(result.baselineWindow).toEqual({ start: 26_100, end: 29_999 });
  });

  test('check the row budget of the baseline too', async () => {
    const { client } = fakeClickHouse(
      () => [],
      (_, params) => (params.start === 10_000 ? 0 : 5_000_000),
    );

    await expect(
      engineWith(client).run(
        query({ dataset: 'spans', dimensions: ['spanName'], measures: ['count'], compare: { previousPeriod: true } }),
        scopeOf([prod], { start: 10_000, end: 20_000 }),
        0,
      ),
    ).rejects.toThrow(
      new QueryBudgetError(
        'The comparison baseline would read about 5,000,000 sampled rows (limit 1,000,000). Narrow the window (e.g. 6h) or add a filter such as operationName or spanName.',
      ),
    );
  });

  test("cut the baseline to the plan's retention, and say so", async () => {
    const { client, queries } = fakeClickHouse();

    const result = await engineWith(client).run(
      query({ dataset: 'spans', dimensions: ['spanName'], measures: ['count'], compare: { previousPeriod: true } }),
      scopeOf([prod], { start: 10_000, end: 20_000 }, 5000),
      0,
    );

    expect(datasetQueries(queries, 'd_spanName').map((q) => [q.params.start, q.params.end])).toEqual([
      [10_000, 20_000],
      [5000, 9999],
    ]);
    expect(result.baselineWindow).toEqual({ start: 5000, end: 9999 });
    expect(result.warnings).toEqual([
      "The baseline was cut to your plan's retention: it covers 1970-01-01T01:23:20Z to 1970-01-01T02:46:39Z, which is shorter than the current window.",
    ]);
  });

  test("refuse a baseline outside the plan's retention", async () => {
    const { client } = fakeClickHouse();

    await expect(
      engineWith(client).run(
        query({
          dataset: 'operation_metrics',
          dimensions: ['operationName'],
          measures: ['requests'],
          compare: {
            previousPeriod: false,
            baselineStart: '1970-01-01T00:00:00Z',
            baselineEnd: '1970-01-01T00:30:00Z',
          },
        }),
        scopeOf([prod], { start: 10_000, end: 20_000 }, 5000),
        0,
      ),
    ).rejects.toThrow(
      new QueryValidationError(
        "The baseline is outside your plan's retention; use a shorter window or a baseline inside retention.",
      ),
    );
  });
});

describe('includeInactive', () => {
  test('lists inactive graphs that share a name with active ones', async () => {
    const { client } = fakeClickHouse(() => [
      { d_graph: 'g-prod', m_requests: '100' },
      { d_graph: 'g-staging', m_requests: '10' },
    ]);

    const result = await engineWith(client).run(
      query({ dataset: 'operation_metrics', dimensions: ['graph'], measures: ['requests'], includeInactive: true }),
      scopeOf([prod, staging, dev]),
      0,
    );

    expect(result.rows).toEqual([
      { graph: 'main', graphNamespace: 'prod', requests: 100 },
      { graph: 'main', graphNamespace: 'staging', requests: 10 },
      { graph: 'main', graphNamespace: 'dev', requests: 0 },
    ]);
  });

  test('lists inactive subgraphs that share a name with active ones', async () => {
    const subgraphs = [
      { id: 's1', name: 'products' },
      { id: 's2', name: 'products' },
    ];
    const { client } = fakeClickHouse(() => [{ d_subgraph: 's1', m_requests: '7' }]);

    const result = await engineWith(client, {
      organizationSubgraphs: () => Promise.resolve(subgraphs),
      graphSubgraphs: () => Promise.resolve(subgraphs),
    }).run(
      query({ dataset: 'subgraph_metrics', dimensions: ['subgraph'], measures: ['requests'], includeInactive: true }),
      scopeOf([prod]),
      0,
    );

    expect(result.rows).toEqual([
      { subgraph: 'products', subgraphId: 's1', requests: 7 },
      { subgraph: 'products', subgraphId: 's2', requests: 0 },
    ]);
  });
});

describe('Dimension types', () => {
  test('return a numeric dimension as a number, as the catalog types it', async () => {
    const { client } = fakeClickHouse(() => [{ d_pathDepth: '2', m_usages: '10' }]);

    const result = await engineWith(client).run(
      query({ dataset: 'field_usage', dimensions: ['pathDepth'], measures: ['usages'] }),
      scopeOf([prod]),
      0,
    );

    expect(result.rows).toEqual([{ pathDepth: 2, usages: 10 }]);
  });
});

describe('Compositions', () => {
  test('look up only composition IDs, never empty or foreign config versions', async () => {
    const id = '0b0b2f6e-7a7c-4f7e-9a59-6f5a9c1d2e3f';
    const lookups: string[][] = [];
    const { client } = fakeClickHouse(() => [
      { d_composition: id, m_requests: '3' },
      { d_composition: 'not-a-uuid', m_requests: '2' },
      { d_composition: '', m_requests: '1' },
    ]);

    await engineWith(client, {
      compositions: (versions) => {
        lookups.push(versions);
        return Promise.resolve(new Map());
      },
    }).run(
      query({ dataset: 'operation_metrics', dimensions: ['composition'], measures: ['requests'] }),
      scopeOf([prod]),
      0,
    );

    expect(lookups).toEqual([[id]]);
  });
});

describe('Dimension values', () => {
  test('filter attribute keys by the prefix in SQL, before the limit', async () => {
    const { client, queries } = fakeClickHouse(() => [{ d_attributeKeys: 'wg.operation.name', m_count: '40' }]);

    const result = await engineWith(client).dimensionValues({
      query: query({ dataset: 'spans' }),
      dimension: 'attributeKeys',
      prefix: 'wg.',
      scope: scopeOf([prod]),
      limit: 1,
    });

    expect(queries.map((q) => q.sql)).toEqual([
      'SELECT arrayJoin(mapKeys(SpanAttributes)) AS d_attributeKeys, count() AS m_count FROM cosmo.span_search WHERE OrganizationID = {organizationId:String} AND FederatedGraphID IN {graphIds:Array(String)} AND TimeBucket >= toStartOfFifteenMinutes(toDateTime({start:UInt32})) AND TimeBucket <= toStartOfFifteenMinutes(toDateTime({end:UInt32})) AND Timestamp >= toDateTime({start:UInt32}) AND Timestamp <= toDateTime({end:UInt32}) AND startsWith(d_attributeKeys, {f0:String}) GROUP BY d_attributeKeys ORDER BY m_count DESC, d_attributeKeys ASC LIMIT {limit:UInt32} OFFSET {offset:UInt32}',
    ]);
    expect([queries[0].params.f0, queries[0].params.limit]).toEqual(['wg.', 1]);
    expect(result.values).toEqual([{ value: 'wg.operation.name', count: 40 }]);
  });

  test('apply the prefix of a virtual dimension before the limit', async () => {
    const rows = [
      { d_graph: 'g-alpha', m_requests: '9' },
      { d_graph: 'g-beta', m_requests: '3' },
    ];
    // Like ClickHouse, the fake honours the LIMIT.
    const { client } = fakeClickHouse((_, params) => rows.slice(0, Number(params.limit)));

    const result = await engineWith(client).dimensionValues({
      query: query({ dataset: 'operation_metrics' }),
      dimension: 'graph',
      prefix: 'be',
      scope: scopeOf([alpha, beta]),
      limit: 1,
    });

    expect(result.values).toEqual([{ value: 'beta', count: 3 }]);
  });

  test('count operation documents with a number', async () => {
    const { client } = fakeClickHouse(() => [{ d_operationType: 'query', m_operations: '3' }]);

    const result = await engineWith(client).dimensionValues({
      query: query({ dataset: 'operation_documents' }),
      dimension: 'operationType',
      scope: scopeOf([prod]),
      limit: 5,
    });

    expect(result.values).toEqual([{ value: 'query', count: 3 }]);
  });

  test('refuse a prefix on a dimension that is not text', async () => {
    const { client, queries } = fakeClickHouse();

    await expect(
      engineWith(client).dimensionValues({
        query: query({ dataset: 'spans' }),
        dimension: 'isRoot',
        prefix: 't',
        scope: scopeOf([prod]),
        limit: 5,
      }),
    ).rejects.toThrow(new QueryValidationError('prefix only applies to text dimensions; isRoot is boolean.'));
    expect(queries).toEqual([]);
  });
});
