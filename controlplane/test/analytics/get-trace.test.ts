import { afterAll, beforeAll, beforeEach, describe, expect, Mock, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import { createFederatedGraph, createThenPublishSubgraph, DEFAULT_NAMESPACE, SetupTest } from '../test-util.js';

vi.mock('../../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();
  ClickHouseClient.prototype.database = 'cosmo';
  return { ClickHouseClient };
});

let dbname = '';

const setupGraph = async (client: Awaited<ReturnType<typeof SetupTest>>['client']) => {
  const fedGraphName = genID('fedGraph');
  const label = genUniqueLabel();
  await createThenPublishSubgraph(
    client,
    genID('subgraph'),
    DEFAULT_NAMESPACE,
    'type Query { hello: String! }',
    [label],
    'http://localhost:4001',
  );
  await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:3000');
  const graph = await client.getFederatedGraphByName({ name: fedGraphName, namespace: DEFAULT_NAMESPACE });
  return graph.graph!.id;
};

describe('GetTrace', () => {
  let chClient: ClickHouseClient;

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  beforeEach(() => {
    chClient = new ClickHouseClient();
    vi.clearAllMocks();
  });

  test('bounds the trace lookup to the tracing retention of the plan', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const graphId = await setupGraph(client);
    (chClient.queryPromise as Mock).mockResolvedValue([]);

    const response = await client.getTrace({ id: 't', spanId: 's', federatedGraphId: graphId });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect((chClient.queryPromise as Mock).mock.calls[0][1]).toEqual({
      traceId: 't',
      organizationId: users.adminAliceCompanyA.organizationId,
      federatedGraphId: graphId,
      retentionDays: 7,
      readLimit: 5000,
    });
  });

  test('returns every span attribute in rawAttributes', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const graphId = await setupGraph(client);
    (chClient.queryPromise as Mock).mockResolvedValue([
      {
        timestamp: '2026-10-31 12:00:00.000000000',
        traceId: 't',
        spanId: 's',
        parentSpanId: '',
        spanName: 'query A',
        spanKind: 'SPAN_KIND_SERVER',
        duration: '1000',
        serviceName: 'cosmo-router',
        statusCode: 'STATUS_CODE_UNSET',
        statusMessage: '',
        scopeName: 'otelhttp',
        rawAttributes: { 'wg.operation.name': 'A', 'x-tenant': 't1' },
      },
    ]);

    const response = await client.getTrace({ id: 't', spanId: 's', federatedGraphId: graphId });

    expect(response.spans[0].rawAttributes).toEqual({ 'wg.operation.name': 'A', 'x-tenant': 't1' });
  });

  test('returns the whole trace with events, resource attributes and a summary when no span is given', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const graphId = await setupGraph(client);
    (chClient.queryPromise as Mock).mockResolvedValue([
      spanRow('root', '', 'query A', '2026-10-31 12:00:00.000000000', 10_000_000),
      spanRow('fetch', 'root', 'Engine - Fetch', '2026-10-31 12:00:00.002000000', 6_000_000, {
        statusCode: 'STATUS_CODE_ERROR',
        statusMessage: 'Failed to fetch',
        rawAttributes: { 'wg.subgraph.name': 'products' },
        eventTimestamps: ['2026-10-31 12:00:00.007000000'],
        eventNames: ['Downstream error 1'],
        eventAttributes: [{ 'wg.subgraph.error.extended_code': 'NOT_FOUND', 'wg.subgraph.error.message': 'gone' }],
      }),
    ]);

    const response = await client.getTrace({ id: 't', spanId: '', federatedGraphId: graphId, includeSummary: true });

    expect(response.spans.map((span) => span.spanID)).toEqual(['root', 'fetch']);
    expect(response.spans[0].resourceAttributes).toEqual({ 'host.name': 'host-a' });
    expect(
      response.spans[1].events.map(({ timestamp, name, attributes }) => ({ timestamp, name, attributes })),
    ).toEqual([
      {
        timestamp: 1_793_448_000_007_000_000n,
        name: 'Downstream error 1',
        attributes: { 'wg.subgraph.error.extended_code': 'NOT_FOUND', 'wg.subgraph.error.message': 'gone' },
      },
    ]);
    expect(response.spans[1].attributes.subgraphName).toBe('products');
    expect(response.summary?.durationNs).toBe(10_000_000n);
    expect(response.summary?.subgraphs.map((s) => [s.subgraphName, s.fetches, s.errors])).toEqual([['products', 1, 1]]);
    expect(response.summary?.errors.map((e) => [e.kind, e.code, e.message])).toEqual([
      ['status', '', 'Failed to fetch'],
      ['downstream', 'NOT_FOUND', 'gone'],
    ]);
    expect(response.summary?.eventsAvailable).toBe(true);
    expect(response.truncated).toBe(false);
    expect(response.totalSpans).toBe(2);
  });

  test('returns a span and its descendants, truncated to maxSpans', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const graphId = await setupGraph(client);
    (chClient.queryPromise as Mock).mockResolvedValue([
      spanRow('root', '', 'query A', '2026-10-31 12:00:00.000000000', 10),
      spanRow('a', 'root', 'Operation - Execute', '2026-10-31 12:00:00.000000001', 5),
      spanRow('a1', 'a', 'Engine - Fetch', '2026-10-31 12:00:00.000000002', 2),
      spanRow('a2', 'a', 'Engine - Fetch', '2026-10-31 12:00:00.000000003', 2),
      spanRow('b', 'root', 'Operation - Plan', '2026-10-31 12:00:00.000000004', 1),
    ]);

    const response = await client.getTrace({ id: 't', spanId: 'a', federatedGraphId: graphId, maxSpans: 2 });

    expect(response.spans.map((span) => span.spanID)).toEqual(['a', 'a1']);
    expect(response.truncated).toBe(true);
    expect(response.totalSpans).toBe(3);
    expect(response.summary).toBe(undefined);
  });

  test('rejects maxSpans above 2000', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());
    const graphId = await setupGraph(client);

    const response = await client.getTrace({ id: 't', spanId: '', federatedGraphId: graphId, maxSpans: 2001 });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(response.response?.details).toBe('maxSpans must be between 1 and 2000.');
    expect(chClient.queryPromise).toHaveBeenCalledTimes(0);
  });
});

function spanRow(
  spanId: string,
  parentSpanId: string,
  spanName: string,
  timestamp: string,
  duration: number,
  extra: Record<string, unknown> = {},
) {
  return {
    timestamp,
    traceId: 't',
    spanId,
    parentSpanId,
    spanName,
    spanKind: 'SPAN_KIND_INTERNAL',
    duration: String(duration),
    serviceName: 'cosmo-router',
    statusCode: 'STATUS_CODE_UNSET',
    statusMessage: '',
    scopeName: 'cosmo.router',
    organizationId: 'org',
    federatedGraphId: 'graph',
    rawAttributes: {},
    resourceAttributes: { 'host.name': 'host-a' },
    eventTimestamps: [],
    eventNames: [],
    eventAttributes: [],
    ...extra,
  };
}
