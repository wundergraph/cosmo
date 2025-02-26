import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SetupTest } from '../test-util.js';
import { afterAllSetup, beforeAllSetup } from '../../src/core/test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';

describe('router compatibility-version list tests', () => {
  let chClient: ClickHouseClient;
  let dbname = '';

  vi.mock('../src/core/clickhouse/index.js', () => {
    const ClickHouseClient = vi.fn();
    ClickHouseClient.prototype.queryPromise = vi.fn();

    return { ClickHouseClient };
  });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an organization can be fetched by slug', async () => {
    const organizationId = randomUUID();
    const organizationSlug = `slug-${organizationId}`;
    const organizationName = 'company-a';
    const { client, server, } = await SetupTest({ dbname, chClient, organizationId, });
    const response = await client.getOrganizationBySlug({
      slug: organizationSlug,
    });
    expect(response.response).toBeDefined();
    expect(response.response!.code).toBe(EnumStatusCode.OK);
    const organization = response.organization;
    expect(organization).toBeDefined();
    expect(organization!.slug).toBe(organizationSlug);
    expect(organization!.name).toBe(organizationName);

    await server.close();
  });
});