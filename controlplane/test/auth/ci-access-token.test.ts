import { randomUUID } from 'node:crypto';
import { createClient, Interceptor } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import build from '../../src/core/build-server.js';
import { signJwtHS256 } from '../../src/core/crypto/jwt.js';
import { RunMigration } from '../../src/core/migrate.js';
import { AuditLogRepository } from '../../src/core/repositories/AuditLogRepository.js';
import { OrganizationRepository } from '../../src/core/repositories/OrganizationRepository.js';
import CiAccessTokenAuthenticator from '../../src/core/services/CiAccessTokenAuthenticator.js';
import { afterAllSetup, beforeAllSetup, genID, seedTest, UserTestData } from '../../src/core/test-util.js';

type Server = Awaited<ReturnType<typeof build>>;

const secret = 'secret';

describe('CI access tokens', () => {
  let dbname = '';
  let server: Server;
  let baseUrl = '';
  let queryConnection: postgres.Sql;

  const companyA: UserTestData = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    organizationName: 'company-a',
    organizationSlug: 'company-a',
    email: 'alice@company-a.test',
    apiKey: `cosmo_${genID('key')}`,
    roles: ['organization-admin'],
  };
  const viewerCompany: UserTestData = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    organizationName: 'viewer-company',
    organizationSlug: 'viewer-company',
    email: 'vera@viewer-company.test',
    apiKey: `cosmo_${genID('key')}`,
    roles: ['organization-viewer'],
  };

  function platformClientWith(token: string) {
    const withToken: Interceptor = (next) => (req) => {
      req.header.set('authorization', `Bearer ${token}`);
      req.header.set('cosmo-org-slug', '');
      return next(req);
    };
    return createClient(
      PlatformService,
      createConnectTransport({ httpVersion: '1.1', baseUrl, interceptors: [withToken] }),
    );
  }

  async function issue(bearer: string | undefined, body: Record<string, string>) {
    const response = await fetch(`${baseUrl}/v1/ci-access-tokens`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  function publishTo(token: string, namespace: string) {
    return platformClientWith(token).publishFederatedSubgraph({
      name: genID('ci-subgraph'),
      namespace,
      schema: 'type Query { fromCi: String! }',
      routingUrl: 'http://localhost:4001',
      labels: [{ key: 'team', value: 'ci' }],
    });
  }

  beforeAll(async () => {
    dbname = await beforeAllSetup();
    const databaseConnectionUrl = `postgresql://postgres:changeme@localhost:5432/${dbname}`;
    await RunMigration(databaseConnectionUrl);

    server = await build({
      logger: { level: 'silent' },
      allowedOrigins: [],
      auth: {
        secret,
        redirectUri: 'http://localhost:3000',
        webBaseUrl: 'http://localhost:3000',
        webErrorPath: '/error',
      },
      database: { url: databaseConnectionUrl },
      keycloak: {
        loginRealm: 'test',
        realm: 'test',
        adminUser: 'admin',
        adminPassword: 'changeme',
        apiUrl: 'http://localhost:8080',
        frontendUrl: 'http://localhost:8080',
        clientId: 'studio',
      },
      slack: { clientID: '', clientSecret: '' },
      s3Storage: {
        url: 'http://localhost:9000',
        region: 'auto',
        endpoint: 'localhost:9000',
        username: 'minio',
        password: 'changeme',
      },
      mailer: {
        smtpEnabled: false,
        smtpHost: '',
        smtpPort: 587,
        smtpUsername: '',
        smtpPassword: '',
        smtpSecure: false,
        smtpRequireTls: true,
      },
      redis: { host: 'localhost', port: 6379 },
      cdnBaseUrl: 'http://localhost:11000',
      admissionWebhook: { secret },
    });
    baseUrl = await server.listen({ port: 0 });

    queryConnection = postgres(databaseConnectionUrl);
    await seedTest(queryConnection, companyA);
    await seedTest(queryConnection, viewerCompany);

    const admin = platformClientWith(companyA.apiKey);
    for (const name of ['prod', 'staging']) {
      const created = await admin.createNamespace({ name });
      expect(created.response?.code).toBe(EnumStatusCode.OK);
    }
    // Migrating a fresh database takes longer than the default hook timeout.
  }, 120_000);

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await queryConnection?.end({ timeout: 1 });
    await server?.close();
    await afterAllSetup(dbname);
  });

  test('a token lasts ten minutes and lets a job publish subgraphs to its namespace', async () => {
    const issuedAt = Date.now();
    const issued = await issue(companyA.apiKey, { namespace: 'prod', repository: 'github.com/acme/shop' });

    expect(issued.status).toBe(201);
    expect(issued.body.namespace).toBe('prod');
    expect(issued.body.token.startsWith('cosmo_ci_')).toBe(true);
    const lifetimeSeconds = (Date.parse(issued.body.expiresAt) - issuedAt) / 1000;
    expect(lifetimeSeconds).toBeGreaterThan(590);
    expect(lifetimeSeconds).toBeLessThanOrEqual(600);

    const published = await publishTo(issued.body.token, 'prod');
    expect(published.response?.code).toBe(EnumStatusCode.OK);
  });

  test('a token does not reach another namespace of the organization', async () => {
    const issued = await issue(companyA.apiKey, { namespace: 'prod', repository: 'github.com/acme/shop' });

    const published = await publishTo(issued.body.token, 'staging');

    expect(published.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });

  test('issuing a token and acting with it are recorded for the repository', async () => {
    const issued = await issue(companyA.apiKey, { namespace: 'staging', repository: 'github.com/acme/audit' });
    expect((await publishTo(issued.body.token, 'staging')).response?.code).toBe(EnumStatusCode.OK);

    const logs = await new AuditLogRepository(server.db).getAuditLogs({
      organizationId: companyA.organizationId,
      limit: 50,
      offset: 0,
      startDate: new Date(Date.now() - 60_000).toISOString(),
      endDate: new Date(Date.now() + 60_000).toISOString(),
    });
    const issuedLog = logs.find((log) => log.auditAction === 'ci_access_token.created');
    expect(issuedLog?.auditableDisplayName).toBe('github.com/acme/audit');
    expect(issuedLog?.targetNamespaceDisplayName).toBe('staging');
    const createdByCi = logs.find((log) => log.auditAction === 'subgraph.created');
    expect(createdByCi?.apiKeyName).toBe('ci:github.com/acme/audit');
  });

  test('a credential that may not create subgraphs in the namespace gets no token', async () => {
    const issued = await issue(viewerCompany.apiKey, { namespace: 'default', repository: 'github.com/acme/shop' });

    expect(issued.status).toBe(403);
  });

  test('a CI access token cannot issue another one', async () => {
    const first = await issue(companyA.apiKey, { namespace: 'prod', repository: 'github.com/acme/shop' });

    const renewed = await issue(first.body.token, { namespace: 'prod', repository: 'github.com/acme/shop' });

    expect(renewed).toEqual({ status: 403, body: { error: 'A CI access token cannot issue CI access tokens' } });
  });

  test('a request without a credential or for an unknown namespace gets no token', async () => {
    expect((await issue(undefined, { namespace: 'prod', repository: 'github.com/acme/shop' })).status).toBe(401);
    expect((await issue(companyA.apiKey, { namespace: 'nope', repository: 'github.com/acme/shop' })).status).toBe(404);
  });

  test('a token is refused once it expires', async () => {
    const authenticator = new CiAccessTokenAuthenticator(secret, new OrganizationRepository(server.log, server.db));
    const issued = await authenticator.issue({
      organizationId: companyA.organizationId,
      namespaceId: randomUUID(),
      repository: 'github.com/acme/shop',
      createdById: companyA.userId,
      createdByName: companyA.email,
    });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);

    await expect(authenticator.authenticate(issued.token)).rejects.toThrow('The CI access token is expired');
  });

  test('a token signed with the control plane secret itself is refused', async () => {
    const forged = await signJwtHS256({
      secret,
      token: {
        iss: 'cosmo-controlplane',
        aud: 'cosmo:ci-access-token',
        sub: 'github.com/acme/shop',
        exp: Math.trunc(Date.now() / 1000) + 600,
        organization_id: companyA.organizationId,
        namespace_id: randomUUID(),
        created_by_id: companyA.userId,
        created_by_name: companyA.email,
      },
    });

    const whoAmI = await platformClientWith(`cosmo_ci_${forged}`).whoAmI({});

    expect(whoAmI.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHENTICATED);
    expect(whoAmI.response?.details).toBe('The CI access token is invalid');
  });
});
