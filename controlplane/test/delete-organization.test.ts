import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { OidcRepository } from '../src/core/repositories/OidcRepository.js';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel, TestUser } from '../src/core/test-util.js';
import { createFederatedGraph, createThenPublishSubgraph, DEFAULT_NAMESPACE, SetupTest } from './test-util.js';

let dbname = '';

describe('Delete Organization', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should delete all targets when deleting org', async (testContext) => {
    const { client, server, users, authenticator, blobStorage } = await SetupTest({
      dbname,
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

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const graphRes = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });
    expect(graphRes.response?.code).toBe(EnumStatusCode.OK);
    expect(graphRes.subgraphs.length).toBe(1);

    const graphKey = `${org!.id}/${graphRes.graph?.id}/routerconfigs/latest.json`;

    expect(blobStorage.keys().some((key) => key === graphKey)).toEqual(true);

    const deleteOrgRes = await client.deleteOrganization({
      userID: mainUserContext.userId,
    });
    expect(deleteOrgRes.response?.code).toBe(EnumStatusCode.OK);

    const graphsRes = await client.getFederatedGraphs({});
    expect(graphsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(graphsRes.graphs.length).toBe(0);

    const subgraphsRes = await client.getSubgraphs({});
    expect(subgraphsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraphsRes.graphs.length).toBe(0);

    const orgAfterDeletion = await orgRepo.bySlug(orgName);
    expect(orgAfterDeletion).toBeNull();

    expect(blobStorage.keys().some((key) => key === graphKey)).toEqual(false);
    await server.close();
  });

  test('Should delete OIDC when deleting org', async (testContext) => {
    const { client, server, keycloakClient, realm, users, authenticator } = await SetupTest({
      dbname,
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

    const createOIDCRes = await client.createOIDCProvider({
      clientID: '123',
      clientSecrect: '345',
      discoveryEndpoint: `http://localhost:8080/realms/${realm}/.well-known/openid-configuration`,
      mappers: [],
    });
    expect(createOIDCRes.response?.code).toBe(EnumStatusCode.OK);

    const oidcRepo = new OidcRepository(server.db);
    const provider = await oidcRepo.getOidcProvider({ organizationId: org!.id });
    expect(provider).toBeDefined();

    const deleteOrgRes = await client.deleteOrganization({
      userID: mainUserContext.userId,
    });
    expect(deleteOrgRes.response?.code).toBe(EnumStatusCode.OK);

    const provider2 = await oidcRepo.getOidcProvider({ organizationId: org!.id });
    expect(provider2).toBeUndefined();
    const idp2 = await keycloakClient.client.identityProviders.findOne({
      alias: provider!.alias,
      realm,
    });
    expect(idp2).toBeNull();

    const orgAfterDeletion = await orgRepo.bySlug(orgName);
    expect(orgAfterDeletion).toBeNull();

    await server.close();
  });
});
