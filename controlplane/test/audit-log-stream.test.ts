import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { sql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { normalizeHecEndpoint, sendToHec } from '../src/core/audit-log-stream/splunk-hec.js';
import { AuditLogStreamRepository } from '../src/core/repositories/AuditLogStreamRepository.js';
import { deliverAuditLogs } from '../src/core/workers/AuditLogStreamWorker.js';
import { AuditLogRepository } from '../src/core/repositories/AuditLogRepository.js';
import { RunMigration } from '../src/core/migrate.js';
import * as schema from '../src/db/schema.js';
import { afterAllSetup, beforeAllSetup, genID, TestUser } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

interface ReceivedRequest {
  authorization?: string;
  channel?: string;
  events: any[];
}

/**
 * A minimal stand-in for a Splunk HTTP Event Collector.
 */
async function startFakeHec(token: string, opts: { requireChannel?: boolean } = {}) {
  const received: ReceivedRequest[] = [];
  let failNext = 0;

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => resolve(body));
    });

  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url !== '/services/collector/event') {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Splunk ${token}`) {
      res.writeHead(403, { 'Content-Type': 'application/json' }).end('{"text":"Invalid token","code":4}');
      return;
    }
    // Tokens with indexer acknowledgement enabled reject requests without a channel.
    const channel = req.headers['x-splunk-request-channel'];
    if (opts.requireChannel && typeof channel !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"text":"Data channel is missing","code":10}');
      return;
    }
    if (failNext > 0) {
      failNext--;
      res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"text":"Server is busy","code":9}');
      return;
    }
    received.push({
      authorization: req.headers.authorization,
      channel: typeof channel === 'string' ? channel : undefined,
      events: body
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    });
    res
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(opts.requireChannel ? '{"text":"Success","code":0,"ackId":0}' : '{"text":"Success","code":0}');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://localhost:${port}`,
    received,
    failNextRequests: (n: number) => {
      failNext = n;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('normalizeHecEndpoint', () => {
  test.each([
    ['https://splunk.example.com:8088', 'https://splunk.example.com:8088/services/collector/event'],
    ['https://splunk.example.com:8088/', 'https://splunk.example.com:8088/services/collector/event'],
    ['https://splunk.example.com:8088/services/collector', 'https://splunk.example.com:8088/services/collector/event'],
    [
      'https://http-inputs-acme.splunkcloud.com/services/collector/event',
      'https://http-inputs-acme.splunkcloud.com/services/collector/event',
    ],
    ['http://localhost:8088', 'http://localhost:8088/services/collector/event'],
  ])('%s', (input, expected) => {
    expect(normalizeHecEndpoint(input)).toBe(expected);
  });

  test.each([
    'not a url',
    'http://splunk.example.com:8088',
    'ftp://splunk.example.com',
    'https://u:p@splunk.example.com',
    'http://127.0.0.1:8088',
  ])('rejects %s', (input) => {
    expect(normalizeHecEndpoint(input)).toBeUndefined();
  });
});

describe('sendToHec', () => {
  test('reports the underlying reason when the collector cannot be reached', async (testContext) => {
    const cause = Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed', { cause })));
    testContext.onTestFinished(() => {
      vi.unstubAllGlobals();
    });

    const target = {
      organizationId: genID('org'),
      endpoint: 'https://splunk.example.com:8088/services/collector/event',
      token: 't',
      index: null,
      source: 'cosmo',
      sourcetype: 'wundergraph:cosmo:audit',
    };
    expect(await sendToHec(target, [{}])).toBe(
      'Could not reach collector: self-signed certificate (DEPTH_ZERO_SELF_SIGNED_CERT)',
    );
  });
});

describe('Audit log streaming', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('configures the stream without ever returning the token', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    expect((await client.getAuditLogStreamConfig({})).config).toBeUndefined();

    const missingToken = await client.upsertAuditLogStreamConfig({
      endpoint: 'https://splunk.example.com',
      enabled: true,
    });
    expect(missingToken.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);

    const insecure = await client.upsertAuditLogStreamConfig({
      endpoint: 'http://splunk.example.com',
      token: 'secret-token-1234',
      enabled: true,
    });
    expect(insecure.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);

    const created = await client.upsertAuditLogStreamConfig({
      endpoint: 'https://splunk.example.com:8088',
      token: 'secret-token-1234',
      index: 'cosmo',
      enabled: true,
    });
    expect(created.response?.code).toBe(EnumStatusCode.OK);

    let res = await client.getAuditLogStreamConfig({});
    expect(res.config).toMatchObject({
      endpoint: 'https://splunk.example.com:8088/services/collector/event',
      tokenSuffix: '1234',
      index: 'cosmo',
      sourcetype: 'wundergraph:cosmo:audit',
      enabled: true,
    });
    expect(JSON.stringify(res.config)).not.toContain('secret-token');

    // Updating without a token keeps the stored one.
    const updated = await client.upsertAuditLogStreamConfig({
      endpoint: 'https://splunk.example.com:8088',
      sourcetype: 'custom',
      enabled: false,
    });
    expect(updated.response?.code).toBe(EnumStatusCode.OK);
    res = await client.getAuditLogStreamConfig({});
    expect(res.config).toMatchObject({ tokenSuffix: '1234', sourcetype: 'custom', enabled: false });
    expect(res.config?.index).toBeUndefined();

    const auditLogs = await client.getAuditLogs({
      limit: 10,
      offset: 0,
      startDate: new Date(Date.now() - 60_000).toISOString(),
      endDate: new Date(Date.now() + 60_000).toISOString(),
    });
    const actions = auditLogs.logs.map((l) => l.auditAction);
    expect(actions).toContain('audit_log_stream_config.created');
    expect(actions).toContain('audit_log_stream_config.updated');

    expect((await client.deleteAuditLogStreamConfig({})).response?.code).toBe(EnumStatusCode.OK);
    expect((await client.getAuditLogStreamConfig({})).config).toBeUndefined();
    expect((await client.deleteAuditLogStreamConfig({})).response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test('only organization admins can manage the stream', async (testContext) => {
    const { client, server, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    authenticator.changeUser(TestUser.devJoeCompanyA);

    const res = await client.upsertAuditLogStreamConfig({
      endpoint: 'https://splunk.example.com',
      token: 'secret',
      enabled: true,
    });
    expect(res.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });

  test('test event reports collector errors', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    const hec = await startFakeHec('good-token');
    testContext.onTestFinished(async () => {
      await hec.close();
      await server.close();
    });

    await client.upsertAuditLogStreamConfig({ endpoint: hec.url, token: 'bad-token', enabled: true });
    const bad = await client.testAuditLogStreamConfig({});
    expect(bad.response?.code).toBe(EnumStatusCode.ERR);
    expect(bad.response?.details).toBe('Collector responded with 403: Invalid token');
    expect((await client.getAuditLogStreamConfig({})).config?.lastError).toBe(
      'Collector responded with 403: Invalid token',
    );

    await client.upsertAuditLogStreamConfig({ endpoint: hec.url, token: 'good-token', enabled: true });
    const good = await client.testAuditLogStreamConfig({});
    expect(good.response?.code).toBe(EnumStatusCode.OK);
    expect(hec.received).toHaveLength(1);
    expect(hec.received[0].channel).toMatch(/^[\da-f-]{36}$/);
    expect(hec.received[0].events[0]).toMatchObject({
      sourcetype: 'wundergraph:cosmo:audit',
      event: { schema_version: 1, action: 'audit_log_stream_config.tested' },
    });
  });
});

/**
 * Delivery only touches Postgres and the collector, so these tests skip the full server setup.
 */
describe('Audit log stream delivery', () => {
  let dbname = '';
  let queryConnection: postgres.Sql;
  let db: PostgresJsDatabase<typeof schema>;
  const logger = pino({ level: 'silent' });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
    const url = `postgresql://postgres:changeme@localhost:5432/${dbname}`;
    await RunMigration(url);
    queryConnection = postgres(url);
    db = drizzle(queryConnection, { schema: { ...schema } });
  });

  afterAll(async () => {
    await queryConnection.end();
    await afterAllSetup(dbname);
  });

  async function setup(endpoint: string) {
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: genID('org'), slug: genID('org') })
      .returning();
    const repo = new AuditLogStreamRepository(db);
    await repo.upsert({
      organizationId: org.id,
      endpoint: normalizeHecEndpoint(endpoint)!,
      token: 'good-token',
      index: 'cosmo',
      source: 'cosmo',
      sourcetype: 'wundergraph:cosmo:audit',
      enabled: true,
    });

    const addLogs = async (count: number, ageSql = "interval '5 minutes'") => {
      const auditLogRepo = new AuditLogRepository(db);
      for (let i = 0; i < count; i++) {
        await auditLogRepo.addAuditLog({
          organizationId: org.id,
          organizationSlug: org.slug,
          auditAction: 'namespace.created',
          action: 'created',
          actorDisplayName: 'cosmo-bot',
          actorType: 'system',
          auditableType: 'namespace',
          auditableDisplayName: `ns-${i}`,
        });
      }
      await db.execute(
        sql`update audit_logs set created_at = created_at - ${sql.raw(ageSql)} where organization_id = ${org.id} and created_at > now() - interval '1 minute'`,
      );
    };

    const deliver = async () => deliverAuditLogs({ repo, config: (await repo.get(org.id))!, logger });

    // Only logs written after the stream was configured are delivered.
    await db.execute(
      sql`update audit_log_stream_configs set cursor_created_at = now() - interval '10 minutes' where organization_id = ${org.id}`,
    );

    return { org, repo, addLogs, deliver };
  }

  test('delivers pending logs in order and retries from the cursor after a failure', async (testContext) => {
    const hec = await startFakeHec('good-token');
    testContext.onTestFinished(() => hec.close());
    const { org, repo, addLogs, deliver } = await setup(hec.url);

    await addLogs(3);

    hec.failNextRequests(1);
    await deliver();
    expect(hec.received).toHaveLength(0);
    expect((await repo.get(org.id))?.lastError).toBe('Collector responded with 503: Server is busy');

    await deliver();
    const events = hec.received.flatMap((r) => r.events);
    expect(events.map((e) => e.event.object.name)).toEqual(['ns-0', 'ns-1', 'ns-2']);
    expect(hec.received.every((r) => r.channel === org.id)).toBe(true);
    expect(events[0]).toMatchObject({
      index: 'cosmo',
      source: 'cosmo',
      sourcetype: 'wundergraph:cosmo:audit',
      event: {
        schema_version: 1,
        action: 'namespace.created',
        organization: { id: org.id, slug: org.slug },
        actor: { type: 'system', name: 'cosmo-bot' },
      },
    });

    const config = await repo.get(org.id);
    expect(config?.lastError).toBeNull();
    expect(config?.lastSuccessAt).toBeTruthy();

    await deliver();
    expect(hec.received.flatMap((r) => r.events)).toHaveLength(3);
  });

  test('delivers to a token with indexer acknowledgement enabled', async (testContext) => {
    const hec = await startFakeHec('good-token', { requireChannel: true });
    testContext.onTestFinished(() => hec.close());
    const { org, repo, addLogs, deliver } = await setup(hec.url);

    await addLogs(2);
    await deliver();
    await deliver();

    expect(hec.received.flatMap((r) => r.events)).toHaveLength(2);
    expect(hec.received.map((r) => r.channel)).toEqual([org.id]);
    expect((await repo.get(org.id))?.lastError).toBeNull();
  });

  test('holds back logs that have not settled yet', async (testContext) => {
    const hec = await startFakeHec('good-token');
    testContext.onTestFinished(() => hec.close());
    const { addLogs, deliver } = await setup(hec.url);

    await addLogs(1, "interval '0 seconds'");
    await deliver();
    expect(hec.received).toHaveLength(0);
  });

  test('does not redeliver a log whose timestamp has sub-millisecond precision', async (testContext) => {
    const hec = await startFakeHec('good-token');
    testContext.onTestFinished(() => hec.close());
    const { org, addLogs, deliver } = await setup(hec.url);

    await addLogs(1);
    await db.execute(
      sql`update audit_logs set created_at = date_trunc('second', created_at) + interval '123456 microseconds' where organization_id = ${org.id}`,
    );

    await deliver();
    await deliver();
    expect(hec.received.flatMap((r) => r.events)).toHaveLength(1);
  });

  test('sends large backlogs in batches', async (testContext) => {
    const hec = await startFakeHec('good-token');
    testContext.onTestFinished(() => hec.close());
    const { addLogs, deliver } = await setup(hec.url);

    await addLogs(150);
    await deliver();
    expect(hec.received.map((r) => r.events.length)).toEqual([100, 50]);
  });
});
