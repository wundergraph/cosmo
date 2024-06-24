import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';
import { createPromiseClient, PromiseClient } from '@connectrpc/connect';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { createConnectTransport } from '@connectrpc/connect-node';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import Fastify from 'fastify';
import { pino } from 'pino';
import { expect } from 'vitest';
import postgres from 'postgres';
import { formatISO, startOfTomorrow, startOfYear } from 'date-fns';
import { BlobNotFoundError, BlobObject, BlobStorage } from '../src/core/blobstorage/index.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import database from '../src/core/plugins/database.js';
import fastifyRedis from '../src/core/plugins/redis.js';
import routes from '../src/core/routes.js';
import { Authorization } from '../src/core/services/Authorization.js';
import Keycloak from '../src/core/services/Keycloak.js';
import Mailer from '../src/core/services/Mailer.js';
import {
  createTestAuthenticator,
  createTestContext,
  seedTest,
  TestAuthenticatorOptions,
  UserTestData,
} from '../src/core/test-util.js';
import { MockPlatformWebhookService } from '../src/core/webhooks/PlatformWebhookService.js';
import { AIGraphReadmeQueue } from '../src/core/workers/AIGraphReadmeWorker.js';
import { FeatureIds, Label } from '../src/types/index.js';
import ScimController from '../src/core/controllers/scim.js';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { UserRepository } from '../src/core/repositories/UserRepository.js';
import ApiKeyAuthenticator from '../src/core/services/ApiKeyAuthenticator.js';
import { ApiKeyRepository } from '../src/core/repositories/ApiKeyRepository.js';

export const DEFAULT_ROUTER_URL = 'http://localhost:3002';
export const DEFAULT_SUBGRAPH_URL_ONE = 'http://localhost:4001';
export const DEFAULT_SUBGRAPH_URL_TWO = 'http://localhost:4002';
export const DEFAULT_NAMESPACE = 'default';

export const SetupTest = async function ({
  dbname,
  chClient,
  enabledFeatures,
  enableMultiUsers,
  createScimKey,
}: {
  dbname: string;
  chClient?: ClickHouseClient;
  enableMultiUsers?: boolean;
  createScimKey?: boolean;
  enabledFeatures?: FeatureIds[];
}) {
  const log = pino();
  const databaseConnectionUrl = `postgresql://postgres:changeme@localhost:5432/${dbname}`;
  const server = Fastify({
    logger: log,
  });

  await server.register(database, {
    databaseConnectionUrl,
    debugSQL: false,
    runMigration: true,
  });

  const companyAOrganizationId = randomUUID();
  const aliceContext = createTestContext('company-a', companyAOrganizationId);

  const users: TestAuthenticatorOptions = {
    adminAliceCompanyA: aliceContext,
  };

  if (enableMultiUsers) {
    users.adminBobCompanyA = createTestContext('company-a', companyAOrganizationId);
    users.devJoeCompanyA = createTestContext('company-a', companyAOrganizationId, false, true, ['developer']);
    users.adminJimCompanyB = createTestContext('company-b', randomUUID());
  }

  const authenticator = createTestAuthenticator(users);

  const realm = 'test';
  const loginRealm = 'master';
  const apiUrl = 'http://localhost:8080';
  const clientId = 'studio';
  const adminUser = 'admin';
  const adminPassword = 'changeme';
  const webBaseUrl = 'http://localhost:3000';

  const keycloakClient = new Keycloak({
    apiUrl,
    realm: loginRealm,
    clientId,
    adminUser,
    adminPassword,
  });

  const platformWebhooks = new MockPlatformWebhookService();
  const mailerClient = new Mailer({ username: '', password: '' });

  await server.register(fastifyRedis, {
    host: 'localhost',
    port: 6379,
    password: 'test',
  });

  const readmeQueue = new AIGraphReadmeQueue(log, server.redisForQueue);

  const blobStorage = new InMemoryBlobStorage();
  await server.register(fastifyConnectPlugin, {
    routes: routes({
      chClient,
      db: server.db,
      logger: pino(),
      authenticator,
      jwtSecret: 'secret',
      keycloakRealm: realm,
      keycloakClient,
      platformWebhooks,
      webBaseUrl,
      slack: {
        clientID: '1',
        clientSecret: 'test',
      },
      cdnBaseUrl: 'http://localhost:11000',
      admissionWebhookJWTSecret: 'secret',
      keycloakApiUrl: apiUrl,
      blobStorage,
      mailerClient,
      authorizer: new Authorization(log),
      readmeQueue,
    }),
  });

  const organizationRepository = new OrganizationRepository(log, server.db, '');
  const userRepository = new UserRepository(server.db);
  const apiKeyRepository = new ApiKeyRepository(server.db);
  const apiKeyAuth = new ApiKeyAuthenticator(server.db, organizationRepository);
  await server.register(ScimController, {
    organizationRepository,
    userRepository,
    apiKeyRepository,
    authenticator: apiKeyAuth,
    prefix: '/scim/v2',
    db: server.db,
    keycloakClient,
    keycloakRealm: realm,
  });

  const addr = await server.listen({
    port: 0,
  });

  const queryConnection = postgres(databaseConnectionUrl);

  await seedTest(queryConnection, users.adminAliceCompanyA, createScimKey);

  if (enableMultiUsers) {
    if (users.adminBobCompanyA) {
      await seedTest(queryConnection, users.adminBobCompanyA, createScimKey);
    }
    if (users.adminJimCompanyB) {
      await seedTest(queryConnection, users.adminJimCompanyB, createScimKey);
    }
  }

  await queryConnection.end({
    timeout: 1,
  });

  if (enabledFeatures) {
    for (const feature of enabledFeatures) {
      await organizationRepository.updateFeature({
        organizationId: users.adminAliceCompanyA.organizationId,
        id: feature,
        enabled: true,
      });
      if (enableMultiUsers) {
        if (users.adminBobCompanyA) {
          await organizationRepository.updateFeature({
            organizationId: users.adminBobCompanyA.organizationId,
            id: feature,
            enabled: true,
          });
        }
        if (users.adminJimCompanyB) {
          await organizationRepository.updateFeature({
            organizationId: users.adminJimCompanyB.organizationId,
            id: feature,
            enabled: true,
          });
        }
      }
    }
  }

  const transport = createConnectTransport({
    httpVersion: '1.1',
    baseUrl: addr,
  });

  const platformClient = createPromiseClient(PlatformService, transport);
  const nodeClient = createPromiseClient(NodeService, transport);

  return {
    client: platformClient,
    nodeClient,
    server,
    users,
    blobStorage,
    baseAddress: addr,
    keycloakClient,
    authenticator,
    realm,
  };
};

export const SetupKeycloak = async ({
  keycloakClient,
  userTestData,
  realmName,
}: {
  keycloakClient: Keycloak;
  userTestData: UserTestData;
  realmName: string;
}) => {
  await keycloakClient.authenticateClient();
  await keycloakClient.client.realms.create({
    realm: realmName,
    enabled: true,
    displayName: realmName,
    registrationEmailAsUsername: true,
  });
  const id = await keycloakClient.addKeycloakUser({
    email: userTestData.email,
    realm: realmName,
    isPasswordTemp: false,
    password: 'wunder@123',
    id: userTestData.userId,
  });
  await keycloakClient.seedGroup({
    realm: realmName,
    userID: id,
    organizationSlug: userTestData.organizationSlug,
  });
};

export const removeKeycloakSetup = async ({
  keycloakClient,
  realmName,
}: {
  keycloakClient: Keycloak;
  realmName: string;
}) => {
  await keycloakClient.client.realms.del({
    realm: realmName,
  });
};

export const createThenPublishSubgraph = async (
  client: PromiseClient<typeof PlatformService>,
  name: string,
  namespace: string,
  schemaSDL: string,
  labels: Label[],
  routingUrl: string,
) => {
  const createRes = await client.createFederatedSubgraph({
    name,
    namespace,
    labels,
    routingUrl,
  });
  expect(createRes.response?.code).toBe(EnumStatusCode.OK);
  const publishResp = await client.publishFederatedSubgraph({
    name,
    namespace,
    schema: schemaSDL,
  });
  expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

  return publishResp;
};

export const createAndPublishSubgraph = async (
  client: PromiseClient<typeof PlatformService>,
  name: string,
  namespace: string,
  schemaSDL: string,
  labels: Label[],
  routingUrl: string,
) => {
  const publishResp = await client.publishFederatedSubgraph({
    name,
    namespace,
    labels,
    routingUrl,
    schema: schemaSDL,
  });
  expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

  return publishResp;
};

export const createThenPublishFeatureSubgraph = async (
  client: PromiseClient<typeof PlatformService>,
  name: string,
  baseSubgraphName: string,
  namespace: string,
  schemaSDL: string,
  labels: Label[],
  routingUrl: string,
) => {
  const createRes = await client.createFederatedSubgraph({
    name,
    namespace,
    labels,
    routingUrl,
    isFeatureSubgraph: true,
    baseSubgraphName,
  });
  expect(createRes.response?.code).toBe(EnumStatusCode.OK);
  const publishResp = await client.publishFederatedSubgraph({
    name,
    namespace,
    schema: schemaSDL,
  });
  expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

  return publishResp;
};

export const createFederatedGraph = async (
  client: PromiseClient<typeof PlatformService>,
  name: string,
  namespace: string,
  labelMatchers: string[],
  routingUrl: string,
) => {
  const createFedGraphRes = await client.createFederatedGraph({
    name,
    namespace,
    routingUrl,
    labelMatchers,
  });
  expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);
  return createFedGraphRes;
};

export class InMemoryBlobStorage implements BlobStorage {
  private objects: Map<string, Buffer> = new Map();

  keys() {
    return [...this.objects.keys()];
  }

  putObject<Metadata extends Record<string, string>>({
    key,
    body,
  }: {
    key: string;
    body: Buffer;
    abortSignal?: AbortSignal;
    contentType: string;
    metadata?: Metadata;
  }): Promise<void> {
    this.objects.set(key, body);
    return Promise.resolve();
  }

  getObject(data: { key: string; abortSignal?: AbortSignal }): Promise<BlobObject> {
    const obj = this.objects.get(data.key);
    if (!obj) {
      return Promise.reject(new BlobNotFoundError(`Object with key ${data.key} not found`));
    }
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(obj);
        controller.close();
      },
    });
    return Promise.resolve({
      stream,
    });
  }

  deleteObject(data: { key: string; abortSignal?: AbortSignal }): Promise<void> {
    this.objects.delete(data.key);
    return Promise.resolve();
  }

  removeDirectory(data: { key: string; abortSignal?: AbortSignal }): Promise<number> {
    let count = 0;
    for (const objectKey of this.objects.keys()) {
      if (objectKey.startsWith(data.key)) {
        this.objects.delete(objectKey);
        count++;
      }
    }
    return Promise.resolve(count);
  }
}

export async function createEventDrivenGraph(client: PromiseClient<typeof PlatformService>, name: string) {
  const response = await client.createFederatedSubgraph({
    name,
    namespace: DEFAULT_NAMESPACE,
    isEventDrivenGraph: true,
  });

  expect(response.response?.code).toBe(EnumStatusCode.OK);
}

export async function createSubgraph(
  client: PromiseClient<typeof PlatformService>,
  name: string,
  routingUrl: string,
  namespace = DEFAULT_NAMESPACE,
) {
  const response = await client.createFederatedSubgraph({
    name,
    namespace,
    routingUrl,
  });
  expect(response.response?.code).toBe(EnumStatusCode.OK);
}

export async function createBaseAndFeatureSubgraph(
  client: PromiseClient<typeof PlatformService>,
  baseGraphName: string,
  featureSubgraphName: string,
  baseGraphRoutingUrl: string,
  featureSubgraphRoutingUrl: string,
  namespace = DEFAULT_NAMESPACE,
) {
  await createSubgraph(client, baseGraphName, baseGraphRoutingUrl, namespace);

  const featureSubgraphResponse = await client.createFederatedSubgraph({
    name: featureSubgraphName,
    namespace,
    routingUrl: featureSubgraphRoutingUrl,
    isFeatureSubgraph: true,
    baseSubgraphName: baseGraphName,
  });

  expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
}

export const eventDrivenGraphSDL = `
  type Subscription {
    a: Entity! @edfs__natsSubscribe(subjects: ["a.1"])
  }
  
  type Entity @key(fields: "id", resolvable: false) {
    id: Int! @external
  }
  
  input edfs__NatsStreamConfiguration {
    consumerName: String!
     streamName: String!
  }
`;

export const subgraphSDL = `
  type Query {
    dummy: String!
  }
`;

export const yearStartDate = startOfYear(2024);
export const tomorrowDate = startOfTomorrow();

type IntegrationSubgraph = {
  name: string;
  hasFeatureSubgraph: boolean;
}
export async function featureFlagIntegrationTestSetUp(
  client: PromiseClient<typeof PlatformService>,
  subgraphNames: Array<IntegrationSubgraph>,
  federatedGraphName: string,
  labels: Array<Label> = [],
  namespace = DEFAULT_NAMESPACE,
) {
  let port = 4001;
  for (const { name, hasFeatureSubgraph } of subgraphNames) {
    await createAndPublishSubgraph(
      client,
      name,
      namespace,
      fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/${name}.graphql`)).toString(),
      labels,
      `http://localhost:${port}`,
    );
    port += 1;
    if (!hasFeatureSubgraph) {
      continue;
    }
    const featureSubgraphName = `${name}-feature`;
    await createThenPublishFeatureSubgraph(
      client,
      featureSubgraphName,
      name,
      namespace,
      fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/${featureSubgraphName}.graphql`)).toString(),
      labels,
      `http://localhost:${port + 100}`,
    );
  }

  const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
  await createFederatedGraph(
    client,
    federatedGraphName,
    namespace,
    federatedGraphLabels,
    DEFAULT_ROUTER_URL,
  );
  const federatedGraphResponse = await client.getFederatedGraphByName({
    name: federatedGraphName,
    namespace,
  });
  expect(federatedGraphResponse.response?.code).toBe(EnumStatusCode.OK);
  return federatedGraphResponse;
}

export async function createNamespace(
  client: PromiseClient<typeof PlatformService>,
  name: string,
) {
  const createNamespaceResponse = await client.createNamespace({
    name,
  });
  expect(createNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);
}

export async function createFeatureFlag(
  client: PromiseClient<typeof PlatformService>,
  name: string,
  labels: Array<Label>,
  featureSubgraphNames: Array<string>,
  namespace = DEFAULT_NAMESPACE,
  isEnabled = false,
) {
  const createFeatureFlagResponse = await client.createFeatureFlag({
    name,
    featureSubgraphNames,
    labels,
    namespace,
    isEnabled,
  });
  expect(createFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
}

export async function assertNumberOfCompositions(
  client: PromiseClient<typeof PlatformService>,
  federatedGraphName: string,
  numberOfCompositions: number,
  namespace = DEFAULT_NAMESPACE,
) {
  const getCompositionsResponse = await client.getCompositions({
    fedGraphName: federatedGraphName,
    startDate: formatISO(yearStartDate),
    endDate: formatISO(tomorrowDate),
    namespace,
  });
  expect(getCompositionsResponse.response?.code).toBe(EnumStatusCode.OK);
  expect(getCompositionsResponse.compositions).toHaveLength(numberOfCompositions);
}

export async function assertFeatureFlagExecutionConfig(
  blobStorage: InMemoryBlobStorage,
  key: string,
  hasFeatureFlagExecutionConfig: boolean,
) {
  const blob = await blobStorage.getObject({ key });
  const routerExecutionConfig =  await blob.stream.getReader().read()
    .then((result) => JSON.parse(result.value.toString()));
  if (hasFeatureFlagExecutionConfig) {
    expect(routerExecutionConfig.featureFlagConfigs).toBeDefined();
  } else {
    expect(routerExecutionConfig.featureFlagConfigs).toBeUndefined();
  }
}

export async function toggleFeatureFlag(
  client: PromiseClient<typeof PlatformService>,
  name: string,
  enabled: boolean,
  namespace = DEFAULT_NAMESPACE,
) {
  const enableFeatureFlagResponse = await client.enableFeatureFlag({
    name,
    enabled,
    namespace,
  });
  expect(enableFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
}

export async function deleteFeatureFlag(
  client: PromiseClient<typeof PlatformService>,
  name: string,
  namespace = DEFAULT_NAMESPACE,
) {
  const deleteFeatureFlagResponse = await client.deleteFeatureFlag({
    name,
    namespace
  });
  expect(deleteFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
}

export function getDebugTestOptions(isDebugMode: boolean) {
  if (!isDebugMode) {
    return {};
  }
  return ({
    timeout: 2_000_000
  });
}

export type GraphNameAndKey = {
  key: string;
  name: string;
}