import { randomUUID, UUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import fs from 'node:fs';
import { createPromiseClient, PromiseClient } from '@connectrpc/connect';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { createConnectTransport } from '@connectrpc/connect-node';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { formatISO, startOfTomorrow, startOfYear } from 'date-fns';
import { drizzle } from 'drizzle-orm/postgres-js';
import Fastify from 'fastify';
import { pino } from 'pino';
import postgres from 'postgres';
import { expect } from 'vitest';
import { BlobNotFoundError, BlobObject, BlobStorage } from '../src/core/blobstorage/index.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import ScimController from '../src/core/controllers/scim.js';
import database from '../src/core/plugins/database.js';
import fastifyRedis from '../src/core/plugins/redis.js';
import { ApiKeyRepository } from '../src/core/repositories/ApiKeyRepository.js';
import { BillingRepository, billingSchema } from '../src/core/repositories/BillingRepository.js';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { UserRepository } from '../src/core/repositories/UserRepository.js';
import routes from '../src/core/routes.js';
import ApiKeyAuthenticator from '../src/core/services/ApiKeyAuthenticator.js';
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
import { DeleteOrganizationQueue } from '../src/core/workers/DeleteOrganizationWorker.js';
import * as schema from '../src/db/schema.js';
import { FeatureIds, Label } from '../src/types/index.js';
import { NewBillingPlan, OrganizationRole } from '../src/db/models.js';
import { DeactivateOrganizationQueue } from '../src/core/workers/DeactivateOrganizationWorker.js';
import { DeleteUserQueue } from '../src/core/workers/DeleteUserQueue.js';
import { ReactivateOrganizationQueue } from '../src/core/workers/ReactivateOrganizationWorker.js';
import { DeleteOrganizationAuditLogsQueue } from '../src/core/workers/DeleteOrganizationAuditLogsWorker.js';

export const DEFAULT_ROUTER_URL = 'http://localhost:3002';
export const DEFAULT_SUBGRAPH_URL_ONE = 'http://localhost:4001';
export const DEFAULT_SUBGRAPH_URL_TWO = 'http://localhost:4002';
export const DEFAULT_SUBGRAPH_URL_THREE = 'http://localhost:4003';
export const DEFAULT_NAMESPACE = 'default';

const getKeycloakGroups = async (realm: string, keycloak: Keycloak, groupId: string | undefined) => {
  if (!groupId) {
    return [];
  }

  const subgroups = await keycloak.fetchAllSubGroups({ realm, kcGroupId: groupId });
  return subgroups.map((group) => ({
    id: group.id!,
    name: group.name!,
  }));
};

export const SetupTest = async function ({
  dbname,
  chClient,
  enabledFeatures,
  enableMultiUsers,
  createScimKey,
  setupBilling,
  organizationId,
}: {
  dbname: string;
  chClient?: ClickHouseClient;
  enableMultiUsers?: boolean;
  createScimKey?: boolean;
  enabledFeatures?: FeatureIds[];
  setupBilling?: {
    plan: 'developer@1' | 'launch@1' | 'scale@1' | 'enterprise';
  };
  organizationId?: UUID;
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

  const companyAOrganizationId = organizationId || randomUUID();
  const aliceContext = createTestContext('company-a', companyAOrganizationId);

  const users: TestAuthenticatorOptions = {
    adminAliceCompanyA: aliceContext,
  };

  if (enableMultiUsers) {
    users.adminBobCompanyA = createTestContext('company-a', companyAOrganizationId);
    users.devJoeCompanyA = createTestContext('company-a', companyAOrganizationId, ['organization-developer']);
    users.keyManagerSmithCompanyA = createTestContext('company-a', companyAOrganizationId, [
      'organization-apikey-manager',
    ]);
    users.viewerTimCompanyA = createTestContext('company-a', companyAOrganizationId, ['organization-viewer']);
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
    logger: log,
  });

  const platformWebhooks = new MockPlatformWebhookService();
  const mailerClient = new Mailer({
    smtpHost: '',
    smtpPassword: '',
    smtpPort: 0,
    smtpRequireTls: false,
    smtpSecure: false,
    smtpUsername: '',
  });

  await server.register(fastifyRedis, {
    host: 'localhost',
    port: 6379,
  });

  const readmeQueue = new AIGraphReadmeQueue(log, server.redisForQueue);
  const deleteOrganizationQueue = new DeleteOrganizationQueue(log, server.redisForQueue);
  const deleteOrganizationAuditLogsQueue = new DeleteOrganizationAuditLogsQueue(log, server.redisForQueue);
  const deactivateOrganizationQueue = new DeactivateOrganizationQueue(log, server.redisForQueue);
  const deleteUserQueue = new DeleteUserQueue(log, server.redisForQueue);
  const reactivateOrganizationQueue = new ReactivateOrganizationQueue(log, server.redisForQueue);

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
      queues: {
        readmeQueue,
        deleteOrganizationQueue,
        deleteOrganizationAuditLogsQueue,
        deactivateOrganizationQueue,
        reactivateOrganizationQueue,
        deleteUserQueue,
      },
    }),
  });

  const organizationRepository = new OrganizationRepository(log, server.db, '');
  const userRepository = new UserRepository(log, server.db);
  const apiKeyRepository = new ApiKeyRepository(server.db);
  const billingRepository = new BillingRepository(server.db);
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

  const [id, kcRootGroupId] = await SetupKeycloak({
    keycloakClient,
    realmName: realm,
    userTestData: {
      userId: users.adminAliceCompanyA.userId,
      organizationId: users.adminAliceCompanyA.organizationId,
      organizationName: users.adminAliceCompanyA.organizationName,
      organizationSlug: users.adminAliceCompanyA.organizationSlug,
      email: users.adminAliceCompanyA.email,
      apiKey: users.adminAliceCompanyA.apiKey,
      roles: ['organization-admin'],
    },
  });

  users.adminAliceCompanyA.userId = id;
  await seedTest(
    queryConnection,
    users.adminAliceCompanyA,
    createScimKey,
    kcRootGroupId,
    await getKeycloakGroups(realm, keycloakClient, kcRootGroupId),
  );

  if (enableMultiUsers) {
    if (users.adminBobCompanyA) {
      const [id, rootGroupId] = await addKeycloakUser({
        keycloakClient,
        realmName: realm,
        userTestData: {
          userId: users.adminBobCompanyA.userId,
          organizationId: users.adminBobCompanyA.organizationId,
          organizationName: users.adminBobCompanyA.organizationName,
          organizationSlug: users.adminBobCompanyA.organizationSlug,
          email: users.adminBobCompanyA.email,
          apiKey: users.adminBobCompanyA.apiKey,
          roles: ['organization-admin'],
        },
      });
      users.adminBobCompanyA.userId = id;
      await seedTest(
        queryConnection,
        users.adminBobCompanyA,
        createScimKey,
        rootGroupId,
        await getKeycloakGroups(realm, keycloakClient, rootGroupId),
      );
    }

    if (users.devJoeCompanyA) {
      const [id, rootGroupId] = await addKeycloakUser({
        keycloakClient,
        realmName: realm,
        userTestData: {
          userId: users.devJoeCompanyA.userId,
          organizationId: users.devJoeCompanyA.organizationId,
          organizationName: users.devJoeCompanyA.organizationName,
          organizationSlug: users.devJoeCompanyA.organizationSlug,
          email: users.devJoeCompanyA.email,
          apiKey: users.devJoeCompanyA.apiKey,
          roles: ['organization-developer'],
        },
      });
      users.devJoeCompanyA.userId = id;
      await seedTest(
        queryConnection,
        users.devJoeCompanyA,
        undefined,
        rootGroupId,
        await getKeycloakGroups(realm, keycloakClient, rootGroupId),
      );
    }

    if (users.viewerTimCompanyA) {
      const [id, rootGroupId] = await addKeycloakUser({
        keycloakClient,
        realmName: realm,
        userTestData: {
          userId: users.viewerTimCompanyA.userId,
          organizationId: users.viewerTimCompanyA.organizationId,
          organizationName: users.viewerTimCompanyA.organizationName,
          organizationSlug: users.viewerTimCompanyA.organizationSlug,
          email: users.viewerTimCompanyA.email,
          apiKey: users.viewerTimCompanyA.apiKey,
          roles: ['organization-developer'],
        },
      });
      users.viewerTimCompanyA.userId = id;
      await seedTest(
        queryConnection,
        users.viewerTimCompanyA,
        undefined,
        rootGroupId,
        await getKeycloakGroups(realm, keycloakClient, rootGroupId),
      );
    }

    if (users.adminJimCompanyB) {
      const [id, rootGroupId] = await addKeycloakUser({
        keycloakClient,
        realmName: realm,
        userTestData: {
          userId: users.adminJimCompanyB.userId,
          organizationId: users.adminJimCompanyB.organizationId,
          organizationName: users.adminJimCompanyB.organizationName,
          organizationSlug: users.adminJimCompanyB.organizationSlug,
          email: users.adminJimCompanyB.email,
          apiKey: users.adminJimCompanyB.apiKey,
          roles: ['organization-admin'],
        },
      });
      users.adminJimCompanyB.userId = id;
      await seedTest(
        queryConnection,
        users.adminJimCompanyB,
        createScimKey,
        rootGroupId,
        await getKeycloakGroups(realm, keycloakClient, rootGroupId),
      );
    }
  }

  if (setupBilling) {
    await seedBilling(queryConnection);
    await billingRepository.insertPlan(setupBilling.plan, users.adminAliceCompanyA.organizationId);
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
    interceptors: [
      // Interceptor to handle cosmo-cli user-agent
      (next) => (req) => {
        // Check if x-cosmo-client header is set to cosmo-cli
        const cosmoClient = req.header.get('x-cosmo-client');

        if (cosmoClient === 'cosmo-cli') {
          const modifiedHeaders = new Headers(req.header);
          modifiedHeaders.set('user-agent', 'cosmo-cli');
          // Remove the temporary header
          modifiedHeaders.delete('x-cosmo-client');

          const modifiedReq = {
            ...req,
            header: modifiedHeaders,
          };

          return next(modifiedReq);
        }

        // Otherwise, proceed normally
        return next(req);
      },
    ],
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
    queues: {
      readmeQueue,
      deleteOrganizationQueue,
      deleteOrganizationAuditLogsQueue,
      deactivateOrganizationQueue,
      deleteUserQueue,
      reactivateOrganizationQueue,
    },
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

  try {
    await keycloakClient.client.realms.create({
      realm: realmName,
      enabled: true,
      displayName: realmName,
      registrationEmailAsUsername: true,
    });
  } catch (e: any) {
    if (e.response?.status !== 409) {
      e.message = `Failed to create keycloak realm: ${realmName}.` + e.message;
      throw e;
    }
  }

  return addKeycloakUser({
    keycloakClient,
    userTestData,
    realmName,
  });
};

export async function createOrganizationGroup(
  client: PromiseClient<typeof PlatformService>,
  name: string,
  ...rules: { role: OrganizationRole; namespaces?: string[]; resources?: string[] }[]
) {
  const createGroupResponse = await client.createOrganizationGroup({
    name,
    description: '',
  });

  expect(createGroupResponse.response?.code).toBe(EnumStatusCode.OK);
  expect(createGroupResponse.group).toBeDefined();

  if (rules.length === 0) {
    // We don't need to update the group
    return createGroupResponse.group!;
  }

  // Update the group with all the provided roles
  const updateGroupResponse = await client.updateOrganizationGroup({
    groupId: createGroupResponse.group!.groupId,
    description: createGroupResponse.group!.description,
    rules,
  });

  expect(updateGroupResponse.response?.code).toBe(EnumStatusCode.OK);

  // Retrieve the group with the updated roles
  const getGroupsResponse = await client.getOrganizationGroups({});
  expect(getGroupsResponse.response?.code).toBe(EnumStatusCode.OK);

  return getGroupsResponse.groups.find((group) => group.name === name) ?? createGroupResponse.group!;
}

export const addKeycloakUser = async ({
  keycloakClient,
  userTestData,
  realmName,
}: {
  keycloakClient: Keycloak;
  userTestData: UserTestData;
  realmName: string;
}): Promise<[string, string | undefined]> => {
  await keycloakClient.authenticateClient();

  let id = '';
  try {
    id = await keycloakClient.addKeycloakUser({
      email: userTestData.email,
      realm: realmName,
      isPasswordTemp: false,
      password: 'wunder@123',
      id: userTestData.userId,
    });
  } catch (e: any) {
    if (e.response?.status === 409) {
      const res = await keycloakClient.client.users.find({
        realm: realmName,
        email: userTestData.email,
      });
      id = res[0].id!;
    } else {
      e.message = `Failed to add keycloak user: ${userTestData.email}.` + e.message;
      throw e;
    }
  }

  let kcRootGroupId: string | undefined;
  try {
    const [rootGroupId] = await keycloakClient.seedGroup({
      realm: realmName,
      userID: id,
      organizationSlug: userTestData.organizationSlug,
    });

    kcRootGroupId = rootGroupId;
  } catch (e: any) {
    if (e.response?.status !== 409) {
      e.message = `Failed to seed group: ${userTestData.organizationSlug}.` + e.message;
      throw e;
    }
  }

  return [id, kcRootGroupId];
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
  baseSubgraphName: string,
  featureSubgraphName: string,
  baseSubgraphRoutingUrl: string,
  featureSubgraphRoutingUrl: string,
  namespace = DEFAULT_NAMESPACE,
) {
  await createSubgraph(client, baseSubgraphName, baseSubgraphRoutingUrl, namespace);

  const featureSubgraphResponse = await client.createFederatedSubgraph({
    name: featureSubgraphName,
    namespace,
    routingUrl: featureSubgraphRoutingUrl,
    isFeatureSubgraph: true,
    baseSubgraphName,
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
};
export async function featureFlagIntegrationTestSetUp(
  client: PromiseClient<typeof PlatformService>,
  subgraphNames: Array<IntegrationSubgraph>,
  federatedGraphName: string,
  labels: Array<Label> = [],
  namespace = DEFAULT_NAMESPACE,
  subgraphLabelsOverride?: Array<Label>,
) {
  let port = 4001;
  for (const { name, hasFeatureSubgraph } of subgraphNames) {
    await createAndPublishSubgraph(
      client,
      name,
      namespace,
      fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/${name}.graphql`)).toString(),
      subgraphLabelsOverride || labels,
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
  await createFederatedGraph(client, federatedGraphName, namespace, federatedGraphLabels, DEFAULT_ROUTER_URL);
  const federatedGraphResponse = await client.getFederatedGraphByName({
    name: federatedGraphName,
    namespace,
  });
  expect(federatedGraphResponse.response?.code).toBe(EnumStatusCode.OK);
  return federatedGraphResponse;
}

export async function createNamespace(client: PromiseClient<typeof PlatformService>, name: string) {
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
  expectedEnumStatusCode = EnumStatusCode.OK,
  excludeFeatureFlagCompositions = false,
) {
  const getCompositionsResponse = await client.getCompositions({
    fedGraphName: federatedGraphName,
    startDate: formatISO(yearStartDate),
    endDate: formatISO(tomorrowDate),
    namespace,
    excludeFeatureFlagCompositions,
  });
  expect(getCompositionsResponse.response?.code).toBe(expectedEnumStatusCode);
  expect(getCompositionsResponse.compositions).toHaveLength(numberOfCompositions);
}

export async function assertFeatureFlagExecutionConfig(
  blobStorage: InMemoryBlobStorage,
  key: string,
  hasFeatureFlagExecutionConfig: boolean,
) {
  const blob = await blobStorage.getObject({ key });
  const routerExecutionConfig = await blob.stream
    .getReader()
    .read()
    .then((result) => JSON.parse(result.value.toString()));
  if (hasFeatureFlagExecutionConfig) {
    expect(routerExecutionConfig.featureFlagConfigs).toBeDefined();
  } else {
    expect(routerExecutionConfig.featureFlagConfigs).toBeUndefined();
  }
}

export async function assertExecutionConfigSubgraphNames(
  blobStorage: InMemoryBlobStorage,
  key: string,
  subgraphIds: Set<string>,
) {
  const blob = await blobStorage.getObject({ key });
  const routerExecutionConfig = await blob.stream
    .getReader()
    .read()
    .then((result) => JSON.parse(result.value.toString()));
  expect(subgraphIds.size).toBe(routerExecutionConfig.subgraphs.length);
  for (const subgraph of routerExecutionConfig.subgraphs) {
    expect(subgraphIds.has(subgraph.id)).toBe(true);
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
    namespace,
  });
  expect(deleteFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
}

export function getDebugTestOptions(isDebugMode: boolean) {
  if (!isDebugMode) {
    return {};
  }
  return {
    timeout: 2_000_000,
  };
}

export type GraphNameAndKey = {
  key: string;
  name: string;
};

export async function seedBilling(queryConnection: postgres.Sql) {
  const db = drizzle(queryConnection, { schema: { ...schema } });

  const configPath = resolve(process.cwd(), './src/bin/billing.json');

  const data = fs.readFileSync(configPath, 'utf8');
  const json = billingSchema.parse(JSON.parse(data));

  const entries = Object.entries(json.plans);

  for (const [id, plan] of entries) {
    const values: NewBillingPlan = {
      id,
      name: plan.name,
      price: plan.price,
      active: plan.active,
      weight: plan.weight,
      stripePriceId: 'stripePriceId' in plan ? plan.stripePriceId : undefined,
      features: plan.features.map((feature) => ({
        ...feature,
        id: feature.id as FeatureIds,
      })),
    };

    await db
      .insert(schema.billingPlans)
      .values(values)
      .onConflictDoUpdate({
        target: schema.billingPlans.id,
        set: values,
      })
      .execute();
  }
}
