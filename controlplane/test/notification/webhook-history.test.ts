import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { formatISO, subDays, subYears } from 'date-fns';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, createTestGroup, createTestRBACEvaluator } from '../../src/core/test-util.js';
import { SetupTest } from '../test-util.js';

let dbname = '';

describe('Webhook History', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  describe('getOrganizationWebhookHistory', () => {
    test('Should return empty history when no webhooks have been delivered', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const now = new Date();
      const yesterday = subDays(now, 1);

      const response = await client.getOrganizationWebhookHistory({
        pagination: { limit: 10, offset: 0 },
        dateRange: {
          start: formatISO(yesterday),
          end: formatISO(now),
        },
        filterByType: undefined,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.deliveries).toEqual([]);
      expect(response.totalCount).toBe(0);
    });

    test('Should fail when date range is invalid', async (testContext) => {
      const { client, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const response = await client.getOrganizationWebhookHistory({
        pagination: { limit: 10, offset: 0 },
        dateRange: {
          start: formatISO(subYears(new Date(), 5)),
          end: formatISO(subYears(new Date(), 4)),
        },
        filterByType: undefined,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERR);
      expect(response.deliveries).toEqual([]);
    });

    test.each([
      'organization-viewer',
      'organization-apikey-manager',
      'namespace-admin',
      'namespace-viewer',
      'graph-admin',
      'graph-viewer',
      'subgraph-admin',
      'subgraph-publisher',
      'subgraph-viewer',
    ])('%s (non-admin/dev) should NOT be able to get webhook history', async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const now = new Date();
      const yesterday = subDays(now, 1);

      const response = await client.getOrganizationWebhookHistory({
        pagination: { limit: 10, offset: 0 },
        dateRange: {
          start: formatISO(yesterday),
          end: formatISO(now),
        },
        filterByType: undefined,
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    });

    test.each(['organization-admin', 'organization-developer'])(
      '%s should be able to get webhook history',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname });
        onTestFinished(() => server.close());

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(createTestGroup({ role })),
        });

        const now = new Date();
        const yesterday = subDays(now, 1);

        const response = await client.getOrganizationWebhookHistory({
          pagination: { limit: 10, offset: 0 },
          dateRange: {
            start: formatISO(yesterday),
            end: formatISO(now),
          },
          filterByType: undefined,
        });

        expect(response.response?.code).toBe(EnumStatusCode.OK);
      },
    );
  });
});
