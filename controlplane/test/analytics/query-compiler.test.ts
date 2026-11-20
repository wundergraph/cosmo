import { describe, expect, test } from 'vitest';
import { ANALYTICS_DATASETS, type AnalyticsOperatorName } from '@wundergraph/cosmo-shared';
import { compileQuery, type CompileInput } from '../../src/core/repositories/analytics/query/compiler.js';
import {
  findPhysicalDataset,
  HIDDEN_DIMENSIONS,
  PHYSICAL_DATASETS,
  REQUESTS_ROOT_SPANS,
} from '../../src/core/repositories/analytics/query/registry.js';
import { validateQuery, type AnalyticsQueryRequest } from '../../src/core/repositories/analytics/query/validate.js';
import { GRAIN_SECONDS, TIME_BUCKET_SECONDS } from '../../src/core/repositories/analytics/query/window.js';
import { serializeClickHouseParam } from '../../src/core/clickhouse/params.js';

const scope = { organizationId: 'org-1', graphIds: ['g-1'], start: 1000, end: 87_400 };
const virtual = {
  flagVersions: ['v-ff'],
  flagNames: ['beta'],
  flagVersionsByName: { beta: ['v-ff'] },
  subgraphIdsByName: { products: ['sg-1'] },
  organizationSubgraphIds: ['sg-1', 'sg-2'],
};

const TENANT = 'OrganizationID = {organizationId:String} AND FederatedGraphID IN {graphIds:Array(String)}';
const WINDOW = 'Timestamp >= toDateTime({start:UInt32}) AND Timestamp <= toDateTime({end:UInt32})';
const SPAN_WINDOW = `TimeBucket >= toStartOfFifteenMinutes(toDateTime({start:UInt32})) AND TimeBucket <= toStartOfFifteenMinutes(toDateTime({end:UInt32})) AND ${WINDOW}`;

const compile = (
  request: Partial<AnalyticsQueryRequest> & { dataset: string },
  overrides: Partial<CompileInput> = {},
) => {
  const query = validateQuery({
    dimensions: [],
    measures: [],
    filters: [],
    having: [],
    orderBy: [],
    includeInactive: false,
    ...request,
  });
  return compileQuery({
    dataset: query.physical,
    database: 'cosmo',
    dimensions: query.dimensions,
    measures: query.measures,
    filters: query.filters,
    having: query.having,
    timeBucketSeconds: query.timeBucketSeconds,
    orderBy: query.orderBy,
    limit: 21,
    offset: 0,
    rpmMinutes: 1440,
    scope,
    virtual,
    ...overrides,
  });
};

/** The value kind the compiler produces for a catalog unit; every unit not listed is a number. */
const UNIT_KINDS: Record<string, string> = { text: 'string', trace_id: 'string', datetime: 'datetime' };
const kindOfUnit = (unit: string) => UNIT_KINDS[unit] ?? 'number';

describe('Dataset registry', () => {
  test('has SQL for every dimension and measure of the shared catalog, and nothing the catalog lacks', () => {
    for (const descriptor of ANALYTICS_DATASETS) {
      const physical = findPhysicalDataset(descriptor.name)!;
      const variants = descriptor.name === 'requests' ? [physical, REQUESTS_ROOT_SPANS] : [physical];
      const physicalDimensions = new Set(variants.flatMap((v) => Object.keys(v.dimensions)));
      const physicalMeasures = new Set(variants.flatMap((v) => Object.keys(v.measures)));

      expect([...physicalDimensions].filter((d) => !HIDDEN_DIMENSIONS.has(d)).sort()).toEqual(
        descriptor.dimensions.map((d) => d.name).sort(),
      );
      expect([...physicalMeasures].sort()).toEqual(descriptor.measures.map((m) => m.name).sort());
    }
  });

  test('knows the length of every time bucket and window grain the catalog offers', () => {
    // A grain that is not a time span (a row of the dataset) doesn't snap the window.
    const rowGrains = new Set(['request', 'span', 'raw', 'operation']);

    expect(
      ANALYTICS_DATASETS.flatMap((d) => d.timeBuckets.filter((bucket) => !(bucket in TIME_BUCKET_SECONDS))),
    ).toEqual([]);
    expect(
      ANALYTICS_DATASETS.filter((d) => !(d.grain in GRAIN_SECONDS) && !rowGrains.has(d.grain)).map((d) => d.name),
    ).toEqual([]);
  });

  test('offers attr:<key> dimensions exactly where a span attribute map exists', () => {
    const mismatched = ANALYTICS_DATASETS.filter((descriptor) => {
      const physical = findPhysicalDataset(descriptor.name)!;
      const variants = descriptor.name === 'requests' ? [physical, REQUESTS_ROOT_SPANS] : [physical];
      return descriptor.attributeDimensions !== variants.some((v) => Boolean(v.attributeMap));
    });

    expect(mismatched.map((d) => d.name)).toEqual([]);
  });

  test('lists only inventory dimensions that includeInactive can fill', () => {
    expect(
      ANALYTICS_DATASETS.flatMap((d) =>
        d.inventoryDimensions.filter((dimension) => !['graph', 'subgraph', 'featureFlag'].includes(dimension)),
      ),
    ).toEqual([]);
  });

  test('computes each measure as the type the catalog announces', () => {
    const mismatched = ANALYTICS_DATASETS.flatMap((descriptor) => {
      const physical = findPhysicalDataset(descriptor.name)!;
      const variants = descriptor.name === 'requests' ? [physical, REQUESTS_ROOT_SPANS] : [physical];
      return descriptor.measures
        .filter((m) => variants.some((v) => v.measures[m.name] && v.measures[m.name].kind !== kindOfUnit(m.unit)))
        .map((m) => `${descriptor.name}.${m.name}`);
    });

    expect(mismatched).toEqual([]);
  });

  test('counts dimension values with a numeric measure in every dataset', () => {
    const datasets = [...PHYSICAL_DATASETS, REQUESTS_ROOT_SPANS];
    expect(datasets.filter((d) => d.measures[d.countMeasure]?.kind !== 'number').map((d) => d.name)).toEqual([]);
  });
});

describe('compileQuery', () => {
  test('joins the request and latency tables on the dimensions when measures come from both', () => {
    const compiled = compile({
      dataset: 'operation_metrics',
      dimensions: ['operationName'],
      measures: ['requests', 'latencyP95'],
      filters: [{ field: 'clientName', operator: 'eq', values: ['web'] }],
      orderBy: [{ field: 'requests', desc: true }],
    });

    const p95 =
      'round(func_histogram_v2(func_rank(0.95, sumForEachMerge(BucketCounts)), func_rank_bucket_lower_index(func_rank(0.95, sumForEachMerge(BucketCounts)), sumForEachMerge(BucketCounts)), sumForEachMerge(BucketCounts), anyLast(ExplicitBounds)), 2)';
    expect(compiled.sql).toBe(
      `SELECT d_operationName, m_requests, m_latencyP95 FROM (SELECT OperationName AS d_operationName, sum(TotalRequests) AS m_requests FROM cosmo.operation_request_metrics_5_30 WHERE ${TENANT} AND ${WINDOW} AND ClientName = {f0:String} GROUP BY d_operationName) AS m FULL OUTER JOIN (SELECT OperationName AS d_operationName, ${p95} AS m_latencyP95 FROM cosmo.operation_latency_metrics_5_30 WHERE ${TENANT} AND ${WINDOW} AND ClientName = {f0:String} GROUP BY d_operationName) AS l USING (d_operationName) ORDER BY m_requests DESC, d_operationName ASC LIMIT {limit:UInt32} OFFSET {offset:UInt32} SETTINGS join_use_nulls = 1`,
    );
    expect(compiled.params).toEqual({
      organizationId: 'org-1',
      graphIds: ['g-1'],
      start: 1000,
      end: 87_400,
      f0: 'web',
      limit: 21,
      offset: 0,
    });
    expect(compiled.tables).toEqual(['operation_request_metrics_5_30', 'operation_latency_metrics_5_30']);
  });

  test('fills the gaps of a time series', () => {
    const compiled = compile({ dataset: 'operation_metrics', timeBucket: '1h', measures: ['requests'] });

    expect(compiled.sql).toBe(
      `SELECT toUnixTimestamp(toStartOfInterval(Timestamp, INTERVAL {bucketSeconds:UInt32} SECOND)) AS d_time, sum(TotalRequests) AS m_requests FROM cosmo.operation_request_metrics_5_30 WHERE ${TENANT} AND ${WINDOW} GROUP BY d_time ORDER BY d_time ASC WITH FILL FROM {fillFrom:UInt32} TO {fillTo:UInt32} STEP {bucketSeconds:UInt32} LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    );
    expect(compiled.params.bucketSeconds).toBe(3600);
    expect(compiled.params.fillFrom).toBe(0);
    expect(compiled.params.fillTo).toBe(87_401);
  });

  test('groups feature flags in SQL and filters the base graph as every non-flag version', () => {
    const compiled = compile({
      dataset: 'operation_metrics',
      dimensions: ['featureFlag'],
      measures: ['errorRate'],
      filters: [{ field: 'featureFlag', operator: 'in', values: ['beta', ''] }],
    });

    expect(compiled.sql).toBe(
      `SELECT transform(RouterConfigVersion, {flagVersions:Array(String)}, {flagNames:Array(String)}, '') AS d_featureFlag, if(sum(TotalRequests) > 0, round(sum(TotalErrors) / sum(TotalRequests) * 100, 2), 0) AS m_errorRate FROM cosmo.operation_request_metrics_5_30 WHERE ${TENANT} AND ${WINDOW} AND (RouterConfigVersion IN {flagFilter0:Array(String)} OR RouterConfigVersion NOT IN {allFlagVersions:Array(String)}) GROUP BY d_featureFlag ORDER BY d_featureFlag ASC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    );
    expect(compiled.params.flagFilter0).toEqual(['v-ff']);
    expect(compiled.params.allFlagVersions).toEqual(['v-ff']);
  });

  test('reads root spans for requests that use a span attribute, passing the key as a parameter', () => {
    const compiled = compile({
      dataset: 'requests',
      dimensions: ['attr:wg.router.cluster.name'],
      measures: ['count', 'durationP99'],
      filters: [{ field: 'attr:http.client_ip', operator: 'exists', values: [] }],
    });

    expect(compiled.sql).toBe(
      `SELECT SpanAttributes[{attr0:String}] AS d_attr_wg_router_cluster_name, count() AS m_count, round(quantileExact(0.99)(Duration) / 1e6, 3) AS m_durationP99 FROM cosmo.span_search WHERE ${TENANT} AND ${SPAN_WINDOW} AND IsRoot AND mapContains(SpanAttributes, {attr1:String}) GROUP BY d_attr_wg_router_cluster_name ORDER BY d_attr_wg_router_cluster_name ASC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    );
    expect(compiled.params.attr0).toBe('wg.router.cluster.name');
    expect(compiled.params.attr1).toBe('http.client_ip');
  });

  test('reads traces_detail_by_time for requests that only use its columns', () => {
    const compiled = compile({
      dataset: 'requests',
      dimensions: ['httpStatusCode'],
      measures: ['count'],
      filters: [{ field: 'durationMs', operator: 'gt', values: ['1000'] }],
    });

    expect(compiled.sql).toBe(
      `SELECT HttpStatusCode AS d_httpStatusCode, count() AS m_count FROM cosmo.traces_detail_by_time WHERE ${TENANT} AND ${WINDOW} AND (Duration / 1e6) > {f0:Float64} GROUP BY d_httpStatusCode ORDER BY d_httpStatusCode ASC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    );
    expect(compiled.params.f0).toBe(1000);
  });

  test('filters the joined element when grouping and filtering by the same array dimension, and leaves introspection out', () => {
    const compiled = compile({
      dataset: 'field_usage',
      dimensions: ['typeName'],
      measures: ['usages'],
      filters: [{ field: 'typeName', operator: 'eq', values: ['Query'] }],
    });

    expect(compiled.sql).toBe(
      `SELECT arrayJoin(TypeNames) AS d_typeName, sum(TotalUsages) AS m_usages FROM cosmo.gql_metrics_schema_usage_5m_90d WHERE ${TENANT} AND ${WINDOW} AND d_typeName = {f0:String} AND NOT (startsWith(FieldName, '__') OR arrayExists(t -> startsWith(t, '__'), TypeNames)) GROUP BY d_typeName ORDER BY d_typeName ASC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    );
  });

  test('tests membership when filtering an array dimension it does not group by', () => {
    const compiled = compile({
      dataset: 'field_usage',
      dimensions: ['fieldName'],
      measures: ['usages'],
      filters: [{ field: 'typeName', operator: 'in', values: ['Query', 'Mutation'] }],
    });

    expect(compiled.sql).toBe(
      `SELECT FieldName AS d_fieldName, sum(TotalUsages) AS m_usages FROM cosmo.gql_metrics_schema_usage_5m_90d WHERE ${TENANT} AND ${WINDOW} AND hasAny(TypeNames, {f0:Array(String)}) AND NOT (startsWith(FieldName, '__') OR arrayExists(t -> startsWith(t, '__'), TypeNames)) GROUP BY d_fieldName ORDER BY d_fieldName ASC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    );
    expect(compiled.params.f0).toEqual(['Query', 'Mutation']);
  });

  test('only returns documents of operations with traffic in the window', () => {
    const compiled = compile({
      dataset: 'operation_documents',
      dimensions: ['operationHash', 'operationName'],
      filters: [{ field: 'content', operator: 'contains', values: ["it's"] }],
    });

    expect(compiled.sql).toBe(
      `SELECT OperationHash AS d_operationHash, OperationName AS d_operationName, any(OperationContent) AS m_document FROM cosmo.gql_metrics_operations WHERE ${TENANT} AND OperationHash IN (SELECT OperationHash FROM cosmo.gql_metrics_schema_usage_lite_1d_90d WHERE ${TENANT} AND Timestamp >= toStartOfDay(toDateTime({start:UInt32})) AND Timestamp <= toDateTime({end:UInt32})) AND positionCaseInsensitive(OperationContent, {f0:String}) > 0 GROUP BY d_operationHash, d_operationName ORDER BY d_operationHash ASC, d_operationName ASC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    );
    expect(compiled.params.f0).toBe("it's");
  });

  test('computes requests over a bucket bound, filters measures with HAVING and narrows to the organization subgraphs', () => {
    const compiled = compile({
      dataset: 'subgraph_metrics',
      dimensions: ['subgraph'],
      measures: ['requestsOver:500', 'latencyAvg'],
      having: [{ measure: 'latencyAvg', operator: 'gt', value: 100 }],
      orderBy: [{ field: 'latencyAvg', desc: true }],
    });

    expect(compiled.sql).toBe(
      `SELECT SubgraphID AS d_subgraph, if(indexOf(anyLast(ExplicitBounds), {over0:Float64}) = 0, NULL, arraySum(arraySlice(sumForEachMerge(BucketCounts), indexOf(anyLast(ExplicitBounds), {over0:Float64}) + 1))) AS m_requestsOver_500, if(sum(Count) > 0, round(sum(Sum) / sum(Count), 2), 0) AS m_latencyAvg FROM cosmo.subgraph_latency_metrics_5_30 WHERE ${TENANT} AND ${WINDOW} AND SubgraphID IN {organizationSubgraphIds:Array(String)} GROUP BY d_subgraph HAVING m_latencyAvg > {having0:Float64} ORDER BY m_latencyAvg DESC, d_subgraph ASC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    );
    expect(compiled.params.over0).toBe(500);
    expect(compiled.params.having0).toBe(100);
    expect(compiled.params.organizationSubgraphIds).toEqual(['sg-1', 'sg-2']);
  });

  test('resolves a subgraph filter to the subgraph IDs instead of the organization list', () => {
    const compiled = compile({
      dataset: 'subgraph_metrics',
      measures: ['requests'],
      filters: [{ field: 'subgraph', operator: 'eq', values: ['products'] }],
    });

    expect(compiled.sql).toBe(
      `SELECT sum(TotalRequests) AS m_requests FROM cosmo.subgraph_request_metrics_5_30 WHERE ${TENANT} AND ${WINDOW} AND SubgraphID IN {subgraphs0:Array(String)} LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    );
    expect(compiled.params.subgraphs0).toEqual(['sg-1']);
  });

  test('keeps quotes, backslashes and Unicode in values out of the SQL', () => {
    const benign = compile({
      dataset: 'spans',
      dimensions: ['spanName'],
      measures: ['count'],
      filters: [{ field: 'statusMessage', operator: 'contains', values: ['x'] }],
    });
    const hostile = compile({
      dataset: 'spans',
      dimensions: ['spanName'],
      measures: ['count'],
      filters: [{ field: 'statusMessage', operator: 'contains', values: ["'); DROP TABLE x; --\\ ü😀"] }],
    });

    expect(hostile.sql).toBe(benign.sql);
    expect(hostile.params.f0).toBe("'); DROP TABLE x; --\\ ü😀");
  });

  test('rejects attribute keys that could leave the parameter', () => {
    expect(() => compile({ dataset: 'spans', dimensions: ["attr:a']"], measures: ['count'] })).toThrow(
      `"a']" is not a valid attribute key (letters, digits, '_', '.', '-', at most 128 characters).`,
    );
    expect(() => compile({ dataset: 'spans', dimensions: [`attr:${'k'.repeat(129)}`], measures: ['count'] })).toThrow(
      'is not a valid attribute key',
    );
  });
});

const operatorsFor = (type: string, operators: AnalyticsOperatorName[]) =>
  operators.filter((op) => (type === 'number' ? op !== 'contains' && op !== 'starts_with' : true));
const valueFor = (type: string) => (type === 'number' ? '5' : type === 'boolean' ? 'true' : 'x');

describe('Tenant predicate', () => {
  // Every compiled query, for any dataset and any mix of features, reads each table only through the tenant predicate.

  test.each(ANALYTICS_DATASETS.map((d) => [d.name, d] as const))('holds for every query on %s', (_, descriptor) => {
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const groupable = descriptor.dimensions.filter((d) => d.groupable);
    for (let i = 0; i < 60; i++) {
      const dimensions = groupable
        .filter(() => random(3) === 0)
        .map((d) => d.name)
        .slice(0, 3);
      const measures = descriptor.measures.filter(() => random(2) === 0).map((m) => m.name);
      const filters = descriptor.dimensions
        .filter(() => random(4) === 0)
        .map((d) => {
          const operators = operatorsFor(d.type, d.operators);
          const operator = operators[random(operators.length)];
          return {
            field: d.name,
            operator,
            values:
              operator === 'in' || operator === 'not_in' ? [valueFor(d.type), valueFor(d.type)] : [valueFor(d.type)],
          };
        });
      const timeBucket = descriptor.timeBuckets.length > 0 && random(3) === 0 ? descriptor.timeBuckets[0] : undefined;
      const compiled = compile({ dataset: descriptor.name, dimensions, measures, filters, timeBucket });

      const reads = compiled.sql.match(/FROM cosmo\.\w+/g) ?? [];
      const scoped =
        compiled.sql.match(
          /FROM cosmo\.\w+ WHERE OrganizationID = {organizationId:String} AND FederatedGraphID IN {graphIds:Array\(String\)}/g,
        ) ?? [];
      expect(reads.length).toBeGreaterThan(0);
      expect(scoped.length).toBe(reads.length);
      expect(compiled.params.organizationId).toBe('org-1');
      expect(compiled.params.graphIds).toEqual(['g-1']);
    }
  });
});

const encodedSize = (value: unknown) => encodeURIComponent(serializeClickHouseParam(value as string[])).length;

const chunksOf = (params: Record<string, unknown>, name: string) =>
  Object.keys(params).filter((key) => new RegExp(`^${name}\\d+$`).test(key));

const refs = (names: string[]) => names.map((name) => `{${name}:Array(String)}`);

describe('Large ID lists', () => {
  // ClickHouse refuses one HTTP parameter longer than http_max_field_value_size (128 KiB by default).
  const versions = Array.from({ length: 5000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const many = {
    ...virtual,
    flagVersions: versions,
    flagNames: versions.map(() => 'beta'),
    flagVersionsByName: { beta: versions },
    organizationSubgraphIds: versions,
  };

  test('are split into parameters ClickHouse accepts, for feature flags', () => {
    const compiled = compile(
      {
        dataset: 'operation_metrics',
        dimensions: ['featureFlag'],
        measures: ['requests'],
        filters: [{ field: 'featureFlag', operator: 'in', values: ['beta', ''] }],
      },
      { virtual: many },
    );

    const versionChunks = chunksOf(compiled.params, 'flagVersions');
    const nameChunks = chunksOf(compiled.params, 'flagNames');
    const filterChunks = chunksOf(compiled.params, 'flagFilter');
    const allChunks = chunksOf(compiled.params, 'allFlagVersions');
    expect(versionChunks.length).toBeGreaterThan(1);
    expect(
      [...versionChunks, ...nameChunks, ...filterChunks, ...allChunks].filter(
        (key) => encodedSize(compiled.params[key]) > 64 * 1024,
      ),
    ).toEqual([]);
    expect(versionChunks.flatMap((key) => compiled.params[key] as string[])).toEqual(versions);
    expect(filterChunks.flatMap((key) => compiled.params[key] as string[])).toEqual(versions);
    expect(compiled.sql).toBe(
      `SELECT transform(RouterConfigVersion, arrayConcat(${refs(versionChunks).join(', ')}), arrayConcat(${refs(nameChunks).join(', ')}), '') AS d_featureFlag, sum(TotalRequests) AS m_requests FROM cosmo.operation_request_metrics_5_30 WHERE ${TENANT} AND ${WINDOW} AND (${refs(
        filterChunks,
      )
        .map((ref) => `RouterConfigVersion IN ${ref}`)
        .join(' OR ')} OR (${refs(allChunks)
        .map((ref) => `RouterConfigVersion NOT IN ${ref}`)
        .join(
          ' AND ',
        )})) GROUP BY d_featureFlag ORDER BY d_featureFlag ASC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    );
  });

  test('are split into parameters ClickHouse accepts, for subgraph IDs', () => {
    const compiled = compile({ dataset: 'subgraph_metrics', measures: ['requests'] }, { virtual: many });

    const chunks = chunksOf(compiled.params, 'organizationSubgraphIds');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.filter((key) => encodedSize(compiled.params[key]) > 64 * 1024)).toEqual([]);
    expect(chunks.flatMap((key) => compiled.params[key] as string[])).toEqual(versions);
  });
});
