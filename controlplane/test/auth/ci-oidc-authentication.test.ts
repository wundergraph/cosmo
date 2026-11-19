import { randomUUID } from 'node:crypto';
import { createClient, Interceptor } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { createLocalJWKSet, exportJWK, generateKeyPair, JWTVerifyGetKey, KeyLike, SignJWT } from 'jose';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import build from '../../src/core/build-server.js';
import * as schema from '../../src/db/schema.js';
import { RunMigration } from '../../src/core/migrate.js';
import { CiTrustedRepositoryRepository } from '../../src/core/repositories/CiTrustedRepositoryRepository.js';
import { OrganizationGroupRepository } from '../../src/core/repositories/OrganizationGroupRepository.js';
import { OrganizationRepository } from '../../src/core/repositories/OrganizationRepository.js';
import CiOidcAuthenticator, {
  ciIssuers,
  githubActionsIssuer,
  gitlabComIssuer,
} from '../../src/core/services/CiOidcAuthenticator.js';
import { afterAllSetup, beforeAllSetup, genID, seedTest, UserTestData } from '../../src/core/test-util.js';

const selfHostedGitlabIssuer = 'https://gitlab.example.com';
const githubOwnerId = 9_919_001;

type Server = Awaited<ReturnType<typeof build>>;

describe('CI OIDC authentication', () => {
  let dbname = '';
  let server: Server;
  let baseUrl = '';
  let queryConnection: postgres.Sql;
  let issuerKey: KeyLike;
  let foreignKey: KeyLike;
  let keysOf: () => JWTVerifyGetKey;

  const companyA: UserTestData = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    organizationName: 'company-a',
    organizationSlug: 'company-a',
    email: 'alice@company-a.test',
    apiKey: `cosmo_${genID('key')}`,
    roles: ['organization-admin'],
  };
  const companyB: UserTestData = {
    userId: randomUUID(),
    organizationId: randomUUID(),
    organizationName: 'company-b',
    organizationSlug: 'company-b',
    email: 'bob@company-b.test',
    apiKey: `cosmo_${genID('key')}`,
    roles: ['organization-admin'],
  };

  async function trust(input: {
    company: UserTestData;
    provider: 'github' | 'gitlab';
    issuer: string;
    repository: string;
    group: 'admin' | 'developer' | 'viewer';
    refFilter?: string;
  }) {
    const group = await new OrganizationGroupRepository(server.db).byName({
      organizationId: input.company.organizationId,
      name: input.group,
    });
    await new CiTrustedRepositoryRepository(server.db).trust({
      organizationId: input.company.organizationId,
      provider: input.provider,
      issuer: input.issuer,
      repository: input.repository,
      refFilter: input.refFilter,
      groupId: group!.groupId,
      createdById: input.company.userId,
    });
  }

  function signToken({
    issuer = githubActionsIssuer,
    audience = 'cosmo',
    expiresAt = '5 minutes',
    key = issuerKey,
    claims,
  }: {
    issuer?: string;
    audience?: string;
    expiresAt?: string;
    key?: KeyLike;
    claims: Record<string, string>;
  }): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'ci-test-key' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(key);
  }

  function githubToken(
    repository: string,
    ref = 'refs/heads/main',
    overrides: Omit<Parameters<typeof signToken>[0], 'claims'> = {},
  ): Promise<string> {
    return signToken({
      ...overrides,
      claims: { repository, ref, repository_owner_id: String(githubOwnerId), sub: `repo:${repository}:ref:${ref}` },
    });
  }

  // wgc in CI sends the job token as the bearer with an empty organization slug.
  function platformClientWith(token: string, organizationSlug = '') {
    const withToken: Interceptor = (next) => (req) => {
      req.header.set('authorization', `Bearer ${token}`);
      req.header.set('cosmo-org-slug', organizationSlug);
      return next(req);
    };
    return createClient(
      PlatformService,
      createConnectTransport({ httpVersion: '1.1', baseUrl, interceptors: [withToken] }),
    );
  }

  beforeAll(async () => {
    dbname = await beforeAllSetup();
    const databaseConnectionUrl = `postgresql://postgres:changeme@localhost:5432/${dbname}`;
    await RunMigration(databaseConnectionUrl);

    const issuerKeys = await generateKeyPair('RS256');
    issuerKey = issuerKeys.privateKey;
    foreignKey = (await generateKeyPair('RS256')).privateKey;
    const jwks = createLocalJWKSet({
      keys: [{ ...(await exportJWK(issuerKeys.publicKey)), kid: 'ci-test-key', alg: 'RS256' }],
    });
    keysOf = () => jwks;

    server = await build({
      logger: { level: 'silent' },
      allowedOrigins: [],
      auth: {
        secret: 'secret',
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
      admissionWebhook: { secret: 'secret' },
      ciOidc: { gitlabIssuers: [gitlabComIssuer, selfHostedGitlabIssuer], keysOf },
    });
    baseUrl = await server.listen({ port: 0 });

    queryConnection = postgres(databaseConnectionUrl);
    await seedTest(queryConnection, companyA);
    await seedTest(queryConnection, companyB);

    await trust({
      company: companyA,
      provider: 'github',
      issuer: githubActionsIssuer,
      repository: 'Acme/Shop',
      group: 'developer',
      refFilter: 'refs/heads/main',
    });
    await trust({
      company: companyA,
      provider: 'github',
      issuer: githubActionsIssuer,
      repository: 'acme/releases',
      group: 'developer',
      refFilter: 'refs/heads/release/*',
    });
    await trust({
      company: companyA,
      provider: 'github',
      issuer: githubActionsIssuer,
      repository: 'acme/docs',
      group: 'viewer',
    });
    await trust({
      company: companyA,
      provider: 'gitlab',
      issuer: selfHostedGitlabIssuer,
      repository: 'platform/graph',
      group: 'developer',
      refFilter: 'refs/heads/main',
    });
    for (const company of [companyA, companyB]) {
      await trust({
        company,
        provider: 'github',
        issuer: githubActionsIssuer,
        repository: 'acme/shared',
        group: 'viewer',
      });
    }
    // Migrating a fresh database takes longer than the default hook timeout.
  }, 120_000);

  afterAll(async () => {
    await queryConnection?.end({ timeout: 1 });
    await server?.close();
    await afterAllSetup(dbname);
  });

  test('a job of a trusted GitHub repository acts in the organization that trusts it', async () => {
    const client = platformClientWith(await githubToken('acme/shop'));

    const whoAmI = await client.whoAmI({});

    expect(whoAmI.response?.code).toBe(EnumStatusCode.OK);
    expect(whoAmI.organizationSlug).toBe('company-a');
  });

  test('a trusted job publishes a subgraph and reads it back', async () => {
    const client = platformClientWith(await githubToken('acme/shop'));
    const subgraphName = genID('ci-subgraph');
    const schemaSDL = 'type Query { publishedFromCi: String! }';

    const published = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: schemaSDL,
      routingUrl: 'http://localhost:4001',
      labels: [{ key: 'team', value: 'ci' }],
    });
    expect(published.response?.code).toBe(EnumStatusCode.OK);

    const latest = await client.getLatestSubgraphSDL({ name: subgraphName, namespace: 'default' });
    expect(latest.response?.code).toBe(EnumStatusCode.OK);
    expect(latest.sdl).toBe(schemaSDL);
  });

  test('a job only gets the permissions of the group its repository is trusted with', async () => {
    const client = platformClientWith(await githubToken('acme/docs', 'refs/heads/any-branch'));

    const whoAmI = await client.whoAmI({});
    expect(whoAmI.response?.code).toBe(EnumStatusCode.OK);

    const published = await client.publishFederatedSubgraph({
      name: genID('ci-subgraph'),
      namespace: 'default',
      schema: 'type Query { hello: String! }',
      routingUrl: 'http://localhost:4001',
      labels: [{ key: 'team', value: 'ci' }],
    });
    expect(published.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });

  test('a token for another audience is rejected', async () => {
    const client = platformClientWith(await githubToken('acme/shop', 'refs/heads/main', { audience: 'hub' }));

    const whoAmI = await client.whoAmI({});

    expect(whoAmI.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHENTICATED);
    expect(whoAmI.response?.details).toBe('The CI OIDC token has a missing or unexpected "aud" claim');
  });

  test('an expired token is rejected', async () => {
    const client = platformClientWith(await githubToken('acme/shop', 'refs/heads/main', { expiresAt: '-1 minute' }));

    const whoAmI = await client.whoAmI({});

    expect(whoAmI.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHENTICATED);
    expect(whoAmI.response?.details).toBe('The CI OIDC token is expired');
  });

  test('a token the issuer did not sign is rejected', async () => {
    const client = platformClientWith(await githubToken('acme/shop', 'refs/heads/main', { key: foreignKey }));

    const whoAmI = await client.whoAmI({});

    expect(whoAmI.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHENTICATED);
    expect(whoAmI.response?.details).toBe('The CI OIDC token could not be verified');
  });

  test('a job of a repository no organization trusts is rejected', async () => {
    const client = platformClientWith(await githubToken('mallory/shop'));

    const whoAmI = await client.whoAmI({});

    expect(whoAmI.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHENTICATED);
    expect(whoAmI.response?.details).toBe('Repository mallory/shop is not a trusted CI repository');
  });

  test('a job on a ref outside the ref filter is rejected', async () => {
    const client = platformClientWith(await githubToken('acme/shop', 'refs/heads/feature'));

    const whoAmI = await client.whoAmI({});

    expect(whoAmI.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHENTICATED);
    expect(whoAmI.response?.details).toBe(
      'The ref refs/heads/feature of repository acme/shop is not trusted. Trusted refs: refs/heads/main',
    );
  });

  test('a wildcard ref filter trusts every ref it covers and no other', async () => {
    const onRelease = await platformClientWith(await githubToken('acme/releases', 'refs/heads/release/1.2')).whoAmI({});
    const onMain = await platformClientWith(await githubToken('acme/releases', 'refs/heads/main')).whoAmI({});
    const onLookalike = await platformClientWith(
      await githubToken('acme/releases', 'refs/tags/refs/heads/release/1.2'),
    ).whoAmI({});

    expect(onRelease.response?.code).toBe(EnumStatusCode.OK);
    expect(onMain.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHENTICATED);
    expect(onLookalike.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHENTICATED);
  });

  test('a GitLab job is trusted by project path, issuer and branch', async () => {
    const claims = { project_path: 'platform/graph', ref: 'main', ref_type: 'branch' };

    const selfHosted = await platformClientWith(await signToken({ issuer: selfHostedGitlabIssuer, claims })).whoAmI({});
    const sameProjectOnGitlabCom = await platformClientWith(
      await signToken({ issuer: gitlabComIssuer, claims }),
    ).whoAmI({});
    const tagNamedMain = await platformClientWith(
      await signToken({ issuer: selfHostedGitlabIssuer, claims: { ...claims, ref_type: 'tag' } }),
    ).whoAmI({});

    expect(selfHosted.response?.code).toBe(EnumStatusCode.OK);
    expect(selfHosted.organizationSlug).toBe('company-a');
    expect(sameProjectOnGitlabCom.response?.details).toBe('Repository platform/graph is not a trusted CI repository');
    expect(tagNamedMain.response?.details).toBe(
      'The ref refs/tags/main of repository platform/graph is not trusted. Trusted refs: refs/heads/main',
    );
  });

  test('a repository trusted by two organizations must name the organization', async () => {
    const token = await githubToken('acme/shared');

    const unnamed = await platformClientWith(token).whoAmI({});
    const named = await platformClientWith(token, 'company-b').whoAmI({});
    const foreign = await platformClientWith(await githubToken('acme/shop'), 'company-b').whoAmI({});

    expect(unnamed.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHENTICATED);
    expect(unnamed.response?.details).toBe(
      'Repository acme/shared is trusted by several organizations. Name one with the cosmo-org-slug header',
    );
    expect(named.response?.code).toBe(EnumStatusCode.OK);
    expect(named.organizationSlug).toBe('company-b');
    expect(foreign.response?.details).toBe('Repository acme/shop is not a trusted CI repository');
  });

  test('a GitHub job needs the GitHub app on the repository owner when the control plane requires it', async () => {
    const [github] = ciIssuers([]);
    const authenticator = new CiOidcAuthenticator(
      new CiTrustedRepositoryRepository(server.db),
      new OrganizationRepository(server.log, server.db),
      { audience: 'cosmo', issuers: [github], requireGithubAppInstallation: true, keysOf },
    );
    const token = await githubToken('acme/shop');

    await expect(authenticator.authenticate(token, github, null)).rejects.toThrow(
      'The WunderGraph GitHub app is not installed for the owner of repository acme/shop',
    );

    await server.db.insert(schema.gitInstallations).values({
      slug: 'acme',
      type: 'ORGANIZATION',
      providerAccountId: githubOwnerId,
      providerInstallationId: 77,
      providerName: 'github',
    });

    const authContext = await authenticator.authenticate(token, github, null);
    expect(authContext.organizationSlug).toBe('company-a');
    expect(authContext.apiKeyName).toBe('ci:github:acme/shop');
    expect(authContext.userDisplayName).toBe('alice@company-a.test');
    expect(authContext.rbac.roles).toEqual(['organization-developer']);
  });
});
