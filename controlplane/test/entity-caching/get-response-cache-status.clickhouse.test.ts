import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import axios from 'axios';
import { pino } from 'pino';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, beforeAll, describe, expect, test, TestContext, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ResponseCacheStatus } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { createFederatedGraph, createThenPublishSubgraph, DEFAULT_NAMESPACE, SetupTest } from '../test-util.js';

const CLICKHOUSE_URL = process.env.CLICKHOUSE_TEST_URL || 'http://default:changeme@localhost:8123';
const ROLL_UP_TABLE = 'subgraph_response_cache_status_5_30';
const MIGRATIONS_DIR = 'clickhouse/migrations';
const TABLE_MIGRATION = '20261111150001_subgraph_response_cache_status_5_30.sql';
const VIEW_MIGRATION = '20261111150002_subgraph_response_cache_status_5_30_mv.sql';

const ONE_MINUTE_MS = 60 * 1000;
const FIVE_MINUTES_MS = 5 * ONE_MINUTE_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

const KNOWN_OUTCOMES = ['HIT', 'MISS', 'PARTIAL_HIT', 'NOT_CACHEABLE'];

const AGGREGATION_TEMPORALITY_DELTA = 1;
const AGGREGATION_TEMPORALITY_CUMULATIVE = 2;

type RollUpRow = {
  Timestamp: string;
  FederatedGraphID: string;
  OrganizationID: string;
  SubgraphID: string;
  CacheStatus: string;
  TotalFetches: number;
  NonDeltaPoints: number;
};

type MetricPoint = {
  ScopeName: string;
  ScopeVersion: string;
  MetricName: string;
  Attributes: Record<string, string>;
  TimeUnix: string;
  Value: number;
  AggTemp: number;
  IsMonotonic: boolean;
};

type RowTarget = { organizationId: string; federatedGraphId: string; subgraphId: string };

type TestClient = Awaited<ReturnType<typeof SetupTest>>['client'];

let dbname = '';
const chDatabase = `response_cache_status_test_${randomUUID().replaceAll('-', '')}`;
const chDsn = new URL(CLICKHOUSE_URL);
chDsn.searchParams.set('database', chDatabase);
const chClient = new ClickHouseClient({ dsn: chDsn.toString(), logger: pino() });

// The project client appends a FORMAT clause and parses JSON, so it cannot send DDL, which returns an empty body.
function runStatement(statement: string) {
  return axios.post(CLICKHOUSE_URL, statement);
}

function applyMigration(file: string) {
  const migration = readFileSync(join(process.cwd(), MIGRATIONS_DIR, file), 'utf8');
  const up = migration.split('-- migrate:down')[0].replace('-- migrate:up', '');
  // Keeps the 'cosmo.router' scope literal in the view filter unchanged.
  return runStatement(up.replaceAll(/(?<!')\bcosmo\./g, `${chDatabase}.`));
}

// The OpenTelemetry collector creates this table, so no migration exists. It keeps only the columns the view reads,
// with the types of the collector's ClickHouse exporter.
function createMetricSourceTable() {
  return runStatement(`
    CREATE TABLE ${chDatabase}.otel_metrics_sum (
      ScopeName String,
      ScopeVersion String,
      MetricName String,
      Attributes Map(LowCardinality(String), String),
      TimeUnix DateTime64(9),
      Value Float64,
      AggTemp Int32,
      IsMonotonic Bool
    ) ENGINE = MergeTree ORDER BY TimeUnix
  `);
}

function bucketStartingHoursAgo(hours: number) {
  return Math.floor((Date.now() - hours * ONE_HOUR_MS) / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
}

function rollUpRow(
  { organizationId, federatedGraphId, subgraphId }: RowTarget,
  bucket: number,
  CacheStatus: string,
  TotalFetches: number,
  NonDeltaPoints = 0,
): RollUpRow {
  return {
    Timestamp: new Date(bucket).toISOString().slice(0, 19).replace('T', ' '),
    FederatedGraphID: federatedGraphId,
    OrganizationID: organizationId,
    SubgraphID: subgraphId,
    CacheStatus,
    TotalFetches,
    NonDeltaPoints,
  };
}

function routerRequestsPoint(
  { organizationId, federatedGraphId, subgraphId }: RowTarget,
  epochMs: number,
  cacheStatus: string | undefined,
  Value: number,
  AggTemp: number,
  overrides: Partial<Omit<MetricPoint, 'Attributes' | 'TimeUnix'>> = {},
): MetricPoint {
  return {
    ScopeName: 'cosmo.router',
    ScopeVersion: '0.0.1',
    MetricName: 'router.http.requests',
    Attributes: {
      'wg.organization.id': organizationId,
      'wg.federated_graph.id': federatedGraphId,
      'wg.subgraph.id': subgraphId,
      ...(cacheStatus === undefined ? {} : { 'wg.response_cache.status': cacheStatus }),
    },
    // A decimal string is read as epoch seconds, so the instant does not depend on the server time zone.
    TimeUnix: (epochMs / 1000).toFixed(3),
    Value,
    AggTemp,
    IsMonotonic: true,
    ...overrides,
  };
}

function sumFetches(subgraphs: { totalFetches: bigint }[]) {
  return subgraphs.reduce((total, s) => total + s.totalFetches, 0n);
}

async function setupGraphWithSubgraphs(testContext: TestContext, subgraphCount: number) {
  const { client, server, users } = await SetupTest({ dbname, chClient });
  testContext.onTestFinished(() => server.close());

  const label = genUniqueLabel();
  const fedGraphName = genID('fedGraph');
  const subgraphNames = Array.from({ length: subgraphCount }, () => genID('subgraph'));

  for (const [i, name] of subgraphNames.entries()) {
    await createThenPublishSubgraph(
      client,
      name,
      DEFAULT_NAMESPACE,
      `type Query { f${i}: String! }`,
      [label],
      `http://localhost:${8081 + i}`,
    );
  }

  await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

  const graphRes = await client.getFederatedGraphByName({ name: fedGraphName, namespace: DEFAULT_NAMESPACE });
  const targets: RowTarget[] = [];
  for (const name of subgraphNames) {
    const res = await client.getSubgraphByName({ name, namespace: DEFAULT_NAMESPACE });
    targets.push({
      organizationId: users.adminAliceCompanyA.organizationId,
      federatedGraphId: graphRes.graph!.id,
      subgraphId: res.graph!.id,
    });
  }

  return { client, fedGraphName, targets };
}

async function queryWindow(client: TestClient, fedGraphName: string, start: number, end: number) {
  const res = await client.getResponseCacheStatus({
    federatedGraphName: fedGraphName,
    namespace: DEFAULT_NAMESPACE,
    dateRange: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
  });
  expect(res.response?.code, res.response?.details).toBe(EnumStatusCode.OK);

  return res;
}

describe('GetResponseCacheStatus against ClickHouse', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
    await runStatement(`CREATE DATABASE ${chDatabase}`);
    await createMetricSourceTable();
    await applyMigration(TABLE_MIGRATION);
    await applyMigration(VIEW_MIGRATION);
  });

  afterAll(async () => {
    try {
      await runStatement(`DROP DATABASE IF EXISTS ${chDatabase}`);
    } finally {
      chClient.close();
      await afterAllSetup(dbname);
    }
  });

  // Every number Hub shows starts in this view. Other tests write to the roll-up directly, so only this one
  // proves raw router metrics land in the right bucket, graph, subgraph and status.
  test('Should roll up raw router request points into five minute buckets per cache status', async () => {
    const organizationId = randomUUID();
    const federatedGraphId = randomUUID();
    const target: RowTarget = { organizationId, federatedGraphId, subgraphId: randomUUID() };
    const other: RowTarget = { organizationId, federatedGraphId, subgraphId: randomUUID() };
    const boundary = bucketStartingHoursAgo(2);
    const delta = AGGREGATION_TEMPORALITY_DELTA;

    await chClient.insertPromise<MetricPoint>('otel_metrics_sum', [
      routerRequestsPoint(target, boundary - 1000, 'hit', 5, delta),
      routerRequestsPoint(target, boundary + 1000, 'hit', 7, delta),
      routerRequestsPoint(target, boundary + 50_000, 'hit', 4, delta),
      routerRequestsPoint(target, boundary + 20_000, 'miss', 3, delta),
      routerRequestsPoint(target, boundary + 30_000, 'hit', 100, AGGREGATION_TEMPORALITY_CUMULATIVE),
      routerRequestsPoint(other, boundary + 10_000, 'hit', 2, delta),
      routerRequestsPoint(target, boundary + 40_000, undefined, 1000, delta),
      routerRequestsPoint(target, boundary, 'hit', 1000, delta, { MetricName: 'router.http.request.duration' }),
      routerRequestsPoint(target, boundary, 'hit', 1000, delta, { ScopeName: 'other.scope' }),
      routerRequestsPoint(target, boundary, 'hit', 1000, delta, { ScopeVersion: '0.0.2' }),
      routerRequestsPoint(target, boundary, 'hit', 1000, delta, { IsMonotonic: false }),
      routerRequestsPoint({ ...target, organizationId: '' }, boundary, 'hit', 1000, delta),
      routerRequestsPoint({ ...target, federatedGraphId: '' }, boundary, 'hit', 1000, delta),
      routerRequestsPoint({ ...target, subgraphId: '' }, boundary, 'hit', 1000, delta),
    ]);

    // Each rejected point keeps all but one identifier, so a leaked row still matches this filter.
    const rows = await chClient.queryPromise<{
      bucket: number;
      organizationId: string;
      federatedGraphId: string;
      subgraphId: string;
      cacheStatus: string;
      totalFetches: string;
      nonDeltaPoints: string;
    }>(
      `
      SELECT
        toUnixTimestamp(Timestamp) AS bucket,
        OrganizationID AS organizationId,
        FederatedGraphID AS federatedGraphId,
        SubgraphID AS subgraphId,
        CacheStatus AS cacheStatus,
        sum(TotalFetches) AS totalFetches,
        sum(NonDeltaPoints) AS nonDeltaPoints
      FROM ${chDatabase}.${ROLL_UP_TABLE}
      WHERE OrganizationID = {organizationId:String}
        OR FederatedGraphID = {federatedGraphId:String}
        OR SubgraphID IN ({targetSubgraphId:String}, {otherSubgraphId:String})
      GROUP BY Timestamp, OrganizationID, FederatedGraphID, SubgraphID, CacheStatus
      `,
      {
        organizationId,
        federatedGraphId,
        targetSubgraphId: target.subgraphId,
        otherSubgraphId: other.subgraphId,
      },
    );

    const row = (bucket: number, { subgraphId }: RowTarget, cacheStatus: string, fetches: number, points = 0) => ({
      bucket: bucket / 1000,
      organizationId,
      federatedGraphId,
      subgraphId,
      cacheStatus,
      totalFetches: String(fetches),
      nonDeltaPoints: String(points),
    });
    expect(rows).toHaveLength(4);
    expect(rows).toEqual(
      expect.arrayContaining([
        row(boundary - FIVE_MINUTES_MS, target, 'hit', 5),
        row(boundary, target, 'hit', 11, 1),
        row(boundary, target, 'miss', 3),
        row(boundary, other, 'hit', 2),
      ]),
    );
  });

  // Hub shows how often the cache helped. Counting partial hits or skipped lookups
  // as misses makes the cache look less useful than it was.
  test('Should keep every response cache outcome of a subgraph as its own status', async (testContext) => {
    const { client, fedGraphName, targets } = await setupGraphWithSubgraphs(testContext, 1);

    const [target] = targets;
    const a = bucketStartingHoursAgo(2);
    const b = a + FIVE_MINUTES_MS;

    await chClient.insertPromise<RollUpRow>(ROLL_UP_TABLE, [
      rollUpRow(target, a, 'hit', 2),
      rollUpRow(target, b, 'hit', 7),
      rollUpRow(target, a, 'miss', 3),
      rollUpRow(target, a, 'partial_hit', 40),
      rollUpRow(target, a, 'not_cacheable', 50),
      rollUpRow(target, a, 'future_status', 11),
      rollUpRow({ ...target, organizationId: randomUUID() }, a, 'hit', 1000),
      rollUpRow({ ...target, federatedGraphId: randomUUID() }, a, 'hit', 10_000),
    ]);

    const res = await queryWindow(client, fedGraphName, a, b + FIVE_MINUTES_MS);

    const subgraph = res.subgraphs.find((s) => s.subgraphId === target.subgraphId)!;
    expect(subgraph.totalFetches, 'rows of another organization or graph must not be counted').toBe(113n);

    const statuses = subgraph.statuses.map((s) => ({
      cacheStatus: ResponseCacheStatus[s.cacheStatus],
      totalFetches: s.totalFetches,
    }));
    const known = statuses
      .filter((s) => s.totalFetches !== 11n)
      .sort((x, y) => Number(x.totalFetches - y.totalFetches));
    expect(known, 'each outcome must be one entry with the sum of all its buckets').toEqual([
      { cacheStatus: 'MISS', totalFetches: 3n },
      { cacheStatus: 'HIT', totalFetches: 9n },
      { cacheStatus: 'PARTIAL_HIT', totalFetches: 40n },
      { cacheStatus: 'NOT_CACHEABLE', totalFetches: 50n },
    ]);

    const unknown = statuses.filter((s) => s.totalFetches === 11n);
    expect(unknown, 'an unrecognized status must be returned as one entry').toHaveLength(1);
    expect(unknown[0].cacheStatus, 'an unrecognized status must map to a defined enum value').toBeDefined();
    expect(KNOWN_OUTCOMES, 'an unrecognized status must not be reported as a known outcome').not.toContain(
      unknown[0].cacheStatus,
    );
  });

  // Hub shows how much data backs each subgraph's numbers. If checkout was
  // observed in buckets A and C, the gap at B must not count toward its coverage.
  test('Should count the observed five minute buckets of each subgraph once', async (testContext) => {
    const { client, fedGraphName, targets } = await setupGraphWithSubgraphs(testContext, 2);

    const [checkout, catalog] = targets;
    const a = bucketStartingHoursAgo(2);
    const b = a + FIVE_MINUTES_MS;
    const c = b + FIVE_MINUTES_MS;

    await runStatement(`SYSTEM STOP MERGES ${chDatabase}.${ROLL_UP_TABLE}`);
    let res: Awaited<ReturnType<typeof queryWindow>>;
    try {
      await chClient.insertPromise<RollUpRow>(ROLL_UP_TABLE, [
        rollUpRow(checkout, a, 'hit', 2),
        rollUpRow(checkout, a, 'miss', 1),
      ]);
      // A second insert stores another row for the same key, and stopped merges keep it separate for the read.
      await chClient.insertPromise<RollUpRow>(ROLL_UP_TABLE, [
        rollUpRow(checkout, a, 'hit', 3),
        rollUpRow(checkout, c, 'partial_hit', 4),
        rollUpRow(checkout, c, 'not_cacheable', 5),
        rollUpRow(catalog, b, 'hit', 0, 4),
      ]);

      res = await queryWindow(client, fedGraphName, a, c + FIVE_MINUTES_MS);
    } finally {
      await runStatement(`SYSTEM START MERGES ${chDatabase}.${ROLL_UP_TABLE}`);
    }

    const checkoutResult = res.subgraphs.find((s) => s.subgraphId === checkout.subgraphId)!;
    const catalogResult = res.subgraphs.find((s) => s.subgraphId === catalog.subgraphId)!;
    expect(checkoutResult.totalFetches, 'rows split across inserts must be summed').toBe(15n);
    expect(checkoutResult, 'checkout was observed in buckets A and C').toMatchObject({ coverageCount: 2 });
    expect(catalogResult, 'catalog was observed in bucket B with non delta points only').toMatchObject({
      totalFetches: 0n,
      nonDeltaPoints: 4n,
      coverageCount: 1,
    });
  });

  // Hub shows fetch counts for the selected time range. Adjacent ranges must
  // count each bucket once, and the dates shown must match the buckets counted.
  test('Should count each bucket in exactly one of two adjacent windows and report the bounds it counted', async (testContext) => {
    const { client, fedGraphName, targets } = await setupGraphWithSubgraphs(testContext, 1);

    const [target] = targets;
    const a = bucketStartingHoursAgo(2);
    const b = a + FIVE_MINUTES_MS;
    const c = b + FIVE_MINUTES_MS;

    await chClient.insertPromise<RollUpRow>(ROLL_UP_TABLE, [
      rollUpRow(target, a, 'hit', 5),
      rollUpRow(target, b, 'hit', 7),
    ]);

    const first = await queryWindow(client, fedGraphName, a, b);
    const second = await queryWindow(client, fedGraphName, b, c);
    const union = await queryWindow(client, fedGraphName, a, c);
    const unalignedStart = await queryWindow(client, fedGraphName, a + ONE_MINUTE_MS, c);
    const unalignedEnd = await queryWindow(client, fedGraphName, a, b + ONE_MINUTE_MS);
    const empty = await queryWindow(client, fedGraphName, b, b);

    expect.soft(sumFetches(first.subgraphs), '[A, B) must hold only the bucket starting at A').toBe(5n);
    expect.soft(sumFetches(second.subgraphs), '[B, C) must hold only the bucket starting at B').toBe(7n);
    expect.soft(sumFetches(union.subgraphs), '[A, C) must hold both buckets').toBe(12n);

    const effectiveStart = new Date(unalignedStart.interval!.start).getTime();
    expect.soft([a, b], 'an unaligned start must be reported as a bucket boundary').toContain(effectiveStart);
    expect.soft(new Date(unalignedStart.interval!.end).getTime(), 'an aligned end must be reported unchanged').toBe(c);
    expect
      .soft(sumFetches(unalignedStart.subgraphs), 'the count must match the reported start')
      .toBe(effectiveStart === a ? 12n : 7n);

    const effectiveEnd = new Date(unalignedEnd.interval!.end).getTime();
    expect
      .soft(new Date(unalignedEnd.interval!.start).getTime(), 'an aligned start must be reported unchanged')
      .toBe(a);
    expect.soft([b, c], 'an unaligned end must be reported as a bucket boundary').toContain(effectiveEnd);
    expect
      .soft(sumFetches(unalignedEnd.subgraphs), 'the count must match the reported end')
      .toBe(effectiveEnd === b ? 5n : 12n);

    expect.soft(empty.subgraphs, '[B, B) must return no subgraphs although bucket B has fetches').toEqual([]);
    expect
      .soft([empty.interval?.start, empty.interval?.end], '[B, B) must be reported as an empty interval at B')
      .toEqual([new Date(b).toISOString(), new Date(b).toISOString()]);
  });

  // Hub needs an error when it sends invalid dates. Falling back to a different
  // time range would show users cache numbers for dates they never selected.
  test('Should reject an explicitly malformed date range without querying analytics', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const fedGraphName = genID('fedGraph');
    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');
    const validStart = new Date(bucketStartingHoursAgo(2)).toISOString();
    const validEnd = new Date(bucketStartingHoursAgo(1)).toISOString();
    const queryPromise = vi.spyOn(chClient, 'queryPromise');
    testContext.onTestFinished(() => queryPromise.mockRestore());

    const cases = [
      { input: 'invalid start', dateRange: { start: 'not-a-date', end: validEnd } },
      { input: 'invalid end', dateRange: { start: validStart, end: 'not-a-date' } },
      { input: 'empty range', dateRange: { start: '', end: '' } },
    ];

    const results = [];
    for (const { input, dateRange } of cases) {
      queryPromise.mockClear();
      const res = await client.getResponseCacheStatus({
        federatedGraphName: fedGraphName,
        namespace: DEFAULT_NAMESPACE,
        dateRange,
      });
      results.push({ input, code: res.response?.code, analyticsReads: queryPromise.mock.calls.length });
    }

    expect(results).toEqual(cases.map(({ input }) => ({ input, code: EnumStatusCode.ERR, analyticsReads: 0 })));
  });
});
