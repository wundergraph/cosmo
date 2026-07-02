import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { addDays, formatISO, subDays, subYears } from 'date-fns';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import { createNamespace, SetupTest } from '../test-util.js';

let dbname = '';

describe('GetAuditLogs', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('organization-admin should be able to fetch audit logs', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const now = new Date();
    const yesterday = subDays(now, 1);

    const response = await client.getAuditLogs({
      startDate: formatISO(yesterday),
      endDate: formatISO(now),
      limit: 10,
      offset: 0,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
  });

  test('Should return audit logs after creating resources', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const yesterday = subDays(new Date(), 1);

    // Snapshot count of audit logs before any new action. Use an endDate far in
    // the future (tomorrow) so subsequently-created logs are still within range.
    const tomorrow = addDays(new Date(), 1);

    const beforeResponse = await client.getAuditLogs({
      startDate: formatISO(yesterday),
      endDate: formatISO(tomorrow),
      limit: 50,
      offset: 0,
    });
    expect(beforeResponse.response?.code).toBe(EnumStatusCode.OK);
    const beforeCount = beforeResponse.count;

    // Perform one auditable action
    const namespaceName = await createNamespace(client, genID('ns'));

    const afterResponse = await client.getAuditLogs({
      startDate: formatISO(yesterday),
      endDate: formatISO(tomorrow),
      limit: 50,
      offset: 0,
    });

    expect(afterResponse.response?.code).toBe(EnumStatusCode.OK);
    // The count should have grown by exactly 1 (the namespace creation)
    expect(afterResponse.count).toBe(beforeCount + 1);

    // The newest log should be the namespace creation
    const namespaceLog = afterResponse.logs.find(
      (log) => log.auditAction === 'namespace.created' && log.auditableDisplayName === namespaceName,
    );
    expect(namespaceLog?.auditAction).toBe('namespace.created');
    expect(namespaceLog?.action).toBe('created');
  });

  test('Should clamp limit to 50 even when requesting more', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    // Create several namespaces to ensure there is content to fetch
    for (let i = 0; i < 3; i++) {
      await createNamespace(client, genID('ns'));
    }

    const now = new Date();
    const yesterday = subDays(now, 1);

    const response = await client.getAuditLogs({
      startDate: formatISO(yesterday),
      endDate: formatISO(now),
      limit: 100, // Request beyond the cap
      offset: 0,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    // The repo clamps limit to max 50
    const returnedLogsCapped = Math.min(response.count, 50);
    expect(response.logs.length).toBe(returnedLogsCapped);
  });

  test('Should fail when date range is invalid (beyond retention)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const response = await client.getAuditLogs({
      startDate: formatISO(subYears(new Date(), 5)),
      endDate: formatISO(subYears(new Date(), 4)),
      limit: 10,
      offset: 0,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
  });

  test.each([
    'organization-developer',
    'organization-viewer',
    'organization-apikey-manager',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s (non-admin) should NOT be able to fetch audit logs', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const now = new Date();
    const yesterday = subDays(now, 1);

    const response = await client.getAuditLogs({
      startDate: formatISO(yesterday),
      endDate: formatISO(now),
      limit: 10,
      offset: 0,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });
});
