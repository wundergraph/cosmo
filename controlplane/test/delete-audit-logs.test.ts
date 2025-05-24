import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { QueueEvents } from 'bullmq';
import { addDays } from 'date-fns';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { AuditLogRepository } from '../src/core/repositories/AuditLogRepository.js';
import { afterAllSetup, beforeAllSetup, genID, TestUser } from '../src/core/test-util.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { createDeleteOrganizationWorker } from '../src/core/workers/DeleteOrganizationWorker.js';
import { createDeleteOrganizationAuditLogsWorker } from '../src/core/workers/DeleteOrganizationAuditLogsWorker.js';
import { SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Delete Organization Audit Logs', (ctx) => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });


  test('should queue audit logs deletion when org is deleted and delete after scheduled', async (testContext) => {
    const { client, server, keycloakClient, realm, users, authenticator, queues, blobStorage } = await SetupTest({
      dbname,
      chClient,
    });
    const mainUserContext = users[TestUser.adminAliceCompanyA];

    const orgName = genID();
    await client.createOrganization({
      name: orgName,
      slug: orgName,
    });

    const orgRepo = new OrganizationRepository(server.log, server.db);
    const org = await orgRepo.bySlug(orgName);
    expect(org).toBeDefined();

    authenticator.changeUserWithSuppliedContext({
      ...mainUserContext,
      organizationId: org!.id,
      organizationName: org!.name,
      organizationSlug: org!.slug,
    });

    const now = new Date();
    const auditLogRepo = new AuditLogRepository(server.db);
    const logs = await auditLogRepo.getAuditLogs({
      organizationId: org!.id,
      limit: 10,
      offset: 0,
      startDate: addDays(now, -1).toISOString(),
      endDate: now.toISOString(),
    });

    expect(logs.length).toBeGreaterThan(0);

    const worker = createDeleteOrganizationWorker({
      redisConnection: server.redisForWorker,
      db: server.db,
      logger: server.log,
      keycloakClient,
      keycloakRealm: realm,
      blobStorage,
      deleteOrganizationAuditLogsQueue: queues.deleteOrganizationAuditLogsQueue,
    });

    const job = await orgRepo.queueOrganizationDeletion({
      organizationId: org!.id,
      queuedBy: mainUserContext.userDisplayName,
      deleteOrganizationQueue: queues.deleteOrganizationQueue,
    });

    await job.changeDelay(0);
    await job.waitUntilFinished(new QueueEvents(job.queueName));

    const deleteLogsJob = await queues.deleteOrganizationAuditLogsQueue.getJob({
      organizationId: org!.id,
    });
    expect(deleteLogsJob).toBeDefined();

    const logsAfterOrgDeletion = await auditLogRepo.getAuditLogs({
      organizationId: org!.id,
      limit: 10,
      offset: 0,
      startDate: addDays(now, -1).toISOString(),
      endDate: now.toISOString(),
    });

    expect(logsAfterOrgDeletion.length).toBe(logs.length);

    const auditLogsWorker = createDeleteOrganizationAuditLogsWorker({
      redisConnection: server.redisForWorker,
      db: server.db,
      logger: server.log,
    });

    await deleteLogsJob!.changeDelay(0);
    await deleteLogsJob!.waitUntilFinished(new QueueEvents(deleteLogsJob!.queueName));

    const logsAfterDeletion = await auditLogRepo.getAuditLogs({
      organizationId: org!.id,
      limit: 10,
      offset: 0,
      startDate: addDays(now, -1).toISOString(),
      endDate: now.toISOString(),
    });

    expect(logsAfterDeletion.length).toBe(0);

    await worker.close();
    await auditLogsWorker.close();

    await server.close();
  });
});