import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ExpiresAt } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import * as schema from '../src/db/schema.js';
import ApiKeyAuthenticator from '../src/core/services/ApiKeyAuthenticator.js';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

const createKey = async () => {
  const { client, users, server } = await SetupTest({ dbname });
  const orgGroups = await client.getOrganizationGroups({});
  const viewerGroup = orgGroups.groups.find((g) => g.name === 'viewer')!;
  const name = genID('key');
  const response = await client.createAPIKey({
    name,
    expires: ExpiresAt.NEVER,
    userID: users.adminAliceCompanyA.userId,
    groupId: viewerGroup.groupId,
  });
  expect(response.response?.code).toBe(EnumStatusCode.OK);
  const lastUsedAt = async () =>
    (await server.db.query.apiKeys.findFirst({ where: eq(schema.apiKeys.name, name) }))!.lastUsedAt;
  const authenticator = new ApiKeyAuthenticator(server.db, new OrganizationRepository(pino(), server.db));
  return { server, apiKey: response.apiKey, lastUsedAt, authenticator };
};

describe('API key last used at', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('is not updated when the caller asks to skip it', async (testContext) => {
    const { server, apiKey, lastUsedAt, authenticator } = await createKey();
    testContext.onTestFinished(() => server.close());
    const before = await lastUsedAt();

    await authenticator.authenticate(apiKey, { skipApiKeyUsageUpdate: true });

    expect(await lastUsedAt()).toEqual(before);
  });

  test('is updated by default', async (testContext) => {
    const { server, apiKey, lastUsedAt, authenticator } = await createKey();
    testContext.onTestFinished(() => server.close());
    const before = await lastUsedAt();

    await authenticator.authenticate(apiKey);

    expect(await lastUsedAt()).not.toEqual(before);
  });
});
