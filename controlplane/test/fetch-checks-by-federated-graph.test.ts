import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { subDays } from 'date-fns';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import { DEFAULT_NAMESPACE, SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('GetChecksByFederatedGraphName', (ctx) => {
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

  test('Should be able to fetch checks for a federated graph that exists', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const federatedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph');
    const simpleSchema = 'type Query { hello: String }';

    // Create a federated graph
    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Create a subgraph
    const createSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8081',
    });

    expect(createSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Get the subgraph ID
    const getSubgraphResp = await client.getSubgraphByName({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
    const subgraphId = getSubgraphResp.graph?.id;
    expect(subgraphId).toBeDefined();

    // Publish the schema to create an initial check
    const publishResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: simpleSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    // Run a check on the subgraph schema with a slightly different schema
    const modifiedSchema = 'type Query { hello: String, newField: Int }';
    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from(modifiedSchema)),
    });

    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);

    const now = new Date();
    const oneDayAgo = subDays(now, 1);

    // Fetch checks with default settings
    const checksResp = await client.getChecksByFederatedGraphName({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      limit: 10,
      offset: 0,
      startDate: oneDayAgo.toISOString(),
      endDate: now.toISOString(),
      filters: {
        subgraphs: [subgraphId!],
      },
    });

    expect(checksResp.response?.code).toBe(EnumStatusCode.OK);

    // Check if we have checks now after running the check
    expect(checksResp.checks.length).toBe(1);
    expect(checksResp.checksCountBasedOnDateRange).toBe(1);

    // Cleanup
    await server.close();
  });

  test('Should return not found for a non-existent federated graph', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const nonExistentGraphName = genID('nonExistentGraph');

    const checksResp = await client.getChecksByFederatedGraphName({
      name: nonExistentGraphName,
      namespace: DEFAULT_NAMESPACE,
      limit: 10,
      offset: 0,
      filters: {
        subgraphs: [],
      },
    });

    expect(checksResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(checksResp.checks).toHaveLength(0);

    await server.close();
  });

  test('Should return hasChecks=false when no checks have been run', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const federatedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph');

    // Create a federated graph
    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Create a subgraph
    const createSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8081',
    });

    expect(createSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Get the subgraph ID
    const getSubgraphResp = await client.getSubgraphByName({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
    const subgraphId = getSubgraphResp.graph?.id;
    expect(subgraphId).toBeDefined();

    // Publish a schema but don't run any checks
    const publishResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String }',
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    const now = new Date();
    const oneDayAgo = subDays(now, 1);

    // Fetch checks with date range
    const checksResp = await client.getChecksByFederatedGraphName({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      limit: 10,
      offset: 0,
      startDate: oneDayAgo.toISOString(),
      endDate: now.toISOString(),
      filters: {
        subgraphs: [subgraphId!],
      },
    });

    expect(checksResp.response?.code).toBe(EnumStatusCode.OK);

    expect(checksResp.checks).toHaveLength(0);
    expect(checksResp.checksCountBasedOnDateRange).toBe(0);

    await server.close();
  });

  test('Should validate limit parameter', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const federatedGraphName = genID('fedGraph');

    // Create a federated graph
    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    const now = new Date();
    const oneDayAgo = subDays(now, 1);

    // Test with invalid limit (> 50)
    const checksWithInvalidLimitResp = await client.getChecksByFederatedGraphName({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      limit: 51,
      offset: 0,
      startDate: oneDayAgo.toISOString(),
      endDate: now.toISOString(),
      filters: {
        subgraphs: [],
      },
    });

    expect(checksWithInvalidLimitResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(checksWithInvalidLimitResp.response?.details).toBe('Invalid limit');

    // Test with valid limit
    const checksWithValidLimitResp = await client.getChecksByFederatedGraphName({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      limit: 50,
      offset: 0,
      startDate: oneDayAgo.toISOString(),
      endDate: now.toISOString(),
      filters: {
        subgraphs: [],
      },
    });

    expect(checksWithValidLimitResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should filter checks by specified subgraphs', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const federatedGraphName = genID('fedGraph');
    const subgraphName1 = genID('subgraph1');
    const subgraphName2 = genID('subgraph2');

    // Create a federated graph
    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Create first subgraph
    const createSubgraph1Resp = await client.createFederatedSubgraph({
      name: subgraphName1,
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8081',
    });

    expect(createSubgraph1Resp.response?.code).toBe(EnumStatusCode.OK);

    // Get the subgraph ID
    const getSubgraph1Resp = await client.getSubgraphByName({
      name: subgraphName1,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(getSubgraph1Resp.response?.code).toBe(EnumStatusCode.OK);
    const subgraph1Id = getSubgraph1Resp.graph?.id;
    expect(subgraph1Id).toBeDefined();

    // Create second subgraph
    const createSubgraph2Resp = await client.createFederatedSubgraph({
      name: subgraphName2,
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8082',
    });

    expect(createSubgraph2Resp.response?.code).toBe(EnumStatusCode.OK);

    // Get the other subgraph ID to verify filtering is working
    const getSubgraph2Resp = await client.getSubgraphByName({
      name: subgraphName2,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(getSubgraph2Resp.response?.code).toBe(EnumStatusCode.OK);
    const subgraph2Id = getSubgraph2Resp.graph?.id;
    expect(subgraph2Id).toBeDefined();

    // Define small schemas for both subgraphs
    const usersSchema = `
      type User @key(fields: "id") {
        id: ID!
        name: String
      }
      
      type Query {
        getUser(id: ID!): User
      }
    `;

    const pandasSchema = `
      type Panda @key(fields: "id") {
        id: ID!
        name: String
        bambooIntake: Int
      }
      
      type Query {
        getPanda(id: ID!): Panda
      }
    `;

    // Publish schemas to create checks
    const publish1Resp = await client.publishFederatedSubgraph({
      name: subgraphName1,
      namespace: DEFAULT_NAMESPACE,
      schema: usersSchema,
    });

    expect(publish1Resp.response?.code).toBe(EnumStatusCode.OK);

    const publish2Resp = await client.publishFederatedSubgraph({
      name: subgraphName2,
      namespace: DEFAULT_NAMESPACE,
      schema: pandasSchema,
    });

    expect(publish2Resp.response?.code).toBe(EnumStatusCode.OK);

    // Run checks on both subgraphs with slightly modified schemas
    const modifiedUsersSchema = `
      type User @key(fields: "id") {
        id: ID!
        name: String
        age: Int
      }
      
      type Query {
        getUser(id: ID!): User
        searchUsers(term: String): [User]
      }
    `;

    const modifiedPandasSchema = `
      type Panda @key(fields: "id") {
        id: ID!
        name: String
        bambooIntake: Int
        age: Float
      }
      
      type Query {
        getPanda(id: ID!): Panda
        listPandas(limit: Int): [Panda]
      }
    `;

    const check1Resp = await client.checkSubgraphSchema({
      subgraphName: subgraphName1,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from(modifiedUsersSchema)),
    });

    expect(check1Resp.response?.code).toBe(EnumStatusCode.OK);

    const check2Resp = await client.checkSubgraphSchema({
      subgraphName: subgraphName2,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from(modifiedPandasSchema)),
    });

    expect(check2Resp.response?.code).toBe(EnumStatusCode.OK);

    const now = new Date();
    const oneDayAgo = subDays(now, 1);

    // Verify we can get all checks (should include both subgraphs)
    const allChecksResp = await client.getChecksByFederatedGraphName({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      limit: 10,
      offset: 0,
      startDate: oneDayAgo.toISOString(),
      endDate: now.toISOString(),
      filters: {
        subgraphs: [subgraph1Id!, subgraph2Id!],
      },
    });

    expect(allChecksResp.response?.code).toBe(EnumStatusCode.OK);
    expect(allChecksResp.checks.length).toBe(2);
    expect(allChecksResp.checksCountBasedOnDateRange).toBe(2);

    // Now get checks filtered by the first subgraph
    const checksFilteredResp = await client.getChecksByFederatedGraphName({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      limit: 10,
      offset: 0,
      startDate: oneDayAgo.toISOString(),
      endDate: now.toISOString(),
      filters: {
        subgraphs: [subgraph1Id!],
      },
    });

    expect(checksFilteredResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checksFilteredResp.checks.length).toBe(1);
    expect(checksFilteredResp.checksCountBasedOnDateRange).toBe(1);

    // The filtered results should only contain checks for subgraph1
    const checkSubgraphs = checksFilteredResp.checks[0].checkedSubgraphs;
    expect(checkSubgraphs.length).toBe(1);
    expect(checkSubgraphs[0].subgraphName).toBe(subgraphName1);

    // Double-check by filtering for the second subgraph and verifying we get different results
    const checksFilteredResp2 = await client.getChecksByFederatedGraphName({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      limit: 10,
      offset: 0,
      startDate: oneDayAgo.toISOString(),
      endDate: now.toISOString(),
      filters: {
        subgraphs: [subgraph2Id!],
      },
    });

    expect(checksFilteredResp2.response?.code).toBe(EnumStatusCode.OK);
    expect(checksFilteredResp2.checks.length).toBe(1);
    expect(checksFilteredResp2.checksCountBasedOnDateRange).toBe(1);

    // The filtered results should only contain checks for subgraph2
    const checkSubgraphs2 = checksFilteredResp2.checks[0].checkedSubgraphs;
    expect(checkSubgraphs2.length).toBe(1);
    expect(checkSubgraphs2[0].subgraphName).toBe(subgraphName2);

    await server.close();
  });

  test('Should return hasChecks=true when no checks exist for the date range but total checks exist', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const federatedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph');

    // Create a federated graph
    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Create a subgraph
    const createSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8081',
    });

    expect(createSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Get the subgraph ID
    const getSubgraphResp = await client.getSubgraphByName({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
    const subgraphId = getSubgraphResp.graph?.id;
    expect(subgraphId).toBeDefined();

    // Define a small schema for the subgraph
    const schema = `
      type User @key(fields: "id") {
        id: ID!
        name: String
        email: String
      }
      
      type Query {
        getUser(id: ID!): User
      }
    `;

    // Publish the schema to create an initial check
    const publishResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    // Run a check on the subgraph with a modified schema
    const modifiedSchema = `
      type User @key(fields: "id") {
        id: ID!
        name: String
        email: String
        phoneNumber: String
        address: Address
      }
      
      type Address {
        street: String
        city: String
        country: String
      }
      
      type Query {
        getUser(id: ID!): User
        searchUsersByEmail(email: String): User
      }
    `;

    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from(modifiedSchema)),
    });

    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);

    const threeDaysAgo = subDays(new Date(), 3);
    const twoDaysAgo = subDays(new Date(), 2);
    const now = new Date();
    const oneDayAgo = subDays(now, 1);

    // Now query with a past date range where no checks exist
    const checksResp = await client.getChecksByFederatedGraphName({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      limit: 10,
      offset: 0,
      startDate: threeDaysAgo.toISOString(),
      endDate: twoDaysAgo.toISOString(),
      filters: {
        subgraphs: [subgraphId!],
      },
    });

    expect(checksResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checksResp.checks).toHaveLength(0);
    expect(checksResp.checksCountBasedOnDateRange).toBe(0);

    // Verify we can get the actual checks with the current date range
    const currentChecksResp = await client.getChecksByFederatedGraphName({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      limit: 10,
      offset: 0,
      startDate: oneDayAgo.toISOString(),
      endDate: now.toISOString(),
      filters: {
        subgraphs: [subgraphId!],
      },
    });

    expect(currentChecksResp.response?.code).toBe(EnumStatusCode.OK);
    expect(currentChecksResp.checks.length).toBeGreaterThan(0);

    await server.close();
  });

  test('Should handle federated graphs and subgraphs with same names in different namespaces and fetch checks for each federated graph', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    // Define common names for resources in both namespaces
    const federatedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph');
    const simpleSchema = 'type Query { hello: String }';

    // Define two different namespaces
    const namespace1 = 'namespace1';
    const namespace2 = 'namespace2';

    // Create the first namespace
    await client.createNamespace({
      name: namespace1,
    });

    // Create the second namespace
    await client.createNamespace({
      name: namespace2,
    });

    // Create federated graph in namespace1
    const createFedGraph1Resp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: namespace1,
      labelMatchers: ['team=A'],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFedGraph1Resp.response?.code).toBe(EnumStatusCode.OK);

    // Create federated graph in namespace2 with the same name
    const createFedGraph2Resp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: namespace2,
      labelMatchers: ['team=B'],
      routingUrl: 'http://localhost:8090',
    });

    expect(createFedGraph2Resp.response?.code).toBe(EnumStatusCode.OK);

    // Create subgraph in namespace1
    const createSubgraph1Resp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: namespace1,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8081',
    });

    expect(createSubgraph1Resp.response?.code).toBe(EnumStatusCode.OK);

    // Get the subgraph ID for namespace1
    const getSubgraph1Resp = await client.getSubgraphByName({
      name: subgraphName,
      namespace: namespace1,
    });

    expect(getSubgraph1Resp.response?.code).toBe(EnumStatusCode.OK);
    const subgraph1Id = getSubgraph1Resp.graph?.id;
    expect(subgraph1Id).toBeDefined();

    // Create subgraph in namespace2 with the same name
    const createSubgraph2Resp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: namespace2,
      labels: [{ key: 'team', value: 'B' }],
      routingUrl: 'http://localhost:8091',
    });

    expect(createSubgraph2Resp.response?.code).toBe(EnumStatusCode.OK);

    // Get the subgraph ID for namespace2
    const getSubgraph2Resp = await client.getSubgraphByName({
      name: subgraphName,
      namespace: namespace2,
    });

    expect(getSubgraph2Resp.response?.code).toBe(EnumStatusCode.OK);
    const subgraph2Id = getSubgraph2Resp.graph?.id;
    expect(subgraph2Id).toBeDefined();

    // Publish the schema to namespace1 subgraph
    const publish1Resp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: namespace1,
      schema: simpleSchema,
    });

    expect(publish1Resp.response?.code).toBe(EnumStatusCode.OK);

    // Publish the schema to namespace2 subgraph
    const publish2Resp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: namespace2,
      schema: simpleSchema,
    });

    expect(publish2Resp.response?.code).toBe(EnumStatusCode.OK);

    // Run a check on namespace1 subgraph with modified schema
    const modifiedSchema1 = 'type Query { hello: String, namespace1Field: String }';
    const check1Resp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: namespace1,
      schema: Uint8Array.from(Buffer.from(modifiedSchema1)),
    });

    expect(check1Resp.response?.code).toBe(EnumStatusCode.OK);

    // Run a check on namespace2 subgraph with a different modified schema
    const modifiedSchema2 = 'type Query { hello: String, namespace2Field: Int }';
    const check2Resp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: namespace2,
      schema: Uint8Array.from(Buffer.from(modifiedSchema2)),
    });

    expect(check2Resp.response?.code).toBe(EnumStatusCode.OK);

    const now = new Date();
    const oneDayAgo = subDays(now, 1);

    // Fetch checks for namespace1
    const checksResp1 = await client.getChecksByFederatedGraphName({
      name: federatedGraphName,
      namespace: namespace1,
      limit: 10,
      offset: 0,
      startDate: oneDayAgo.toISOString(),
      endDate: now.toISOString(),
      filters: {
        subgraphs: [subgraph1Id!],
      },
    });

    expect(checksResp1.response?.code).toBe(EnumStatusCode.OK);
    expect(checksResp1.checks.length).toBe(1);
    expect(checksResp1.checksCountBasedOnDateRange).toBe(1);

    // Verify we have the namespace1-specific schema changes in the check
    const checkDetailsNamespace1 = checksResp1.checks[0];
    expect(checkDetailsNamespace1.checkedSubgraphs[0].subgraphName).toBe(subgraphName);
    expect(checkDetailsNamespace1.id).toBeDefined();

    // Fetch checks for namespace2
    const checksResp2 = await client.getChecksByFederatedGraphName({
      name: federatedGraphName,
      namespace: namespace2,
      limit: 10,
      offset: 0,
      startDate: oneDayAgo.toISOString(),
      endDate: now.toISOString(),
      filters: {
        subgraphs: [subgraph2Id!],
      },
    });

    expect(checksResp2.response?.code).toBe(EnumStatusCode.OK);
    expect(checksResp2.checks.length).toBe(1);
    expect(checksResp2.checksCountBasedOnDateRange).toBe(1);

    // Verify we have the namespace2-specific schema changes in the check
    const checkDetailsNamespace2 = checksResp2.checks[0];
    expect(checkDetailsNamespace2.checkedSubgraphs[0].subgraphName).toBe(subgraphName);
    expect(checkDetailsNamespace2.id).toBeDefined();

    // Verify the checks from each namespace are different
    expect(checkDetailsNamespace1.id).not.toBe(checkDetailsNamespace2.id);

    // Try to fetch namespace1 checks but with namespace2 - should get empty results
    const checksRespMismatch = await client.getChecksByFederatedGraphName({
      name: federatedGraphName,
      namespace: namespace2,
      limit: 10,
      offset: 0,
      startDate: oneDayAgo.toISOString(),
      endDate: now.toISOString(),
      filters: {
        subgraphs: [subgraph1Id!], // Using namespace1's subgraph ID with namespace2
      },
    });

    // We should get a successful response but with no checks found
    expect(checksRespMismatch.response?.code).toBe(EnumStatusCode.OK);
    // The check should exist for the graph overall, but not for the specified subgraph ID
    expect(checksRespMismatch.checks.length).toBe(0);
    expect(checksRespMismatch.checksCountBasedOnDateRange).toBe(0);

    await server.close();
  });

  test('Should validate that checks are associated to contracts', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const federatedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const subgraphName = genID('subgraph');

    // Schema with tagged fields to test contract filtering
    const subgraphSchema = `
      type Query {
        publicField: String
        internalField: String @tag(name: "internal")
        adminField: String @tag(name: "admin")
      }
    `;

    // 1. Create a subgraph
    const createSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8081',
    });

    expect(createSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Get the subgraph ID
    const getSubgraphResp = await client.getSubgraphByName({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
    const subgraphId = getSubgraphResp.graph?.id;
    expect(subgraphId).toBeDefined();

    // 2. Create a federated graph
    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: ['team=A'],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    // Publish the schema first so the federated graph becomes composable
    const publishResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: subgraphSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    // 3. Create a contract for the federated graph
    const createContractResp = await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: federatedGraphName,
      excludeTags: ['internal', 'admin'], // Exclude internal and admin fields
      routingUrl: 'http://localhost:8082',
      readme: 'Contract for public API',
    });

    expect(createContractResp.response?.code).toBe(EnumStatusCode.OK);

    // Verify that we can fetch the contract graph details to confirm it was created correctly
    const getContractResp = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(getContractResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getContractResp.graph?.name).toBe(contractGraphName);
    expect(getContractResp.graph?.contract).toBeDefined();
    expect(getContractResp.graph?.contract?.excludeTags).toEqual(['internal', 'admin']);

    // 4. Check the subgraph (run schema validation)
    const modifiedSchema = `
      type Query {
        publicField: String
        internalField: String @tag(name: "internal")
        adminField: String @tag(name: "admin")
        newPublicField: Int
        newInternalField: Float @tag(name: "internal")
      }
    `;

    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: Uint8Array.from(Buffer.from(modifiedSchema)),
    });

    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);

    const now = new Date();
    const oneDayAgo = subDays(now, 1);

    // 5. Fetch checks for the original federated graph
    const federatedGraphChecksResp = await client.getChecksByFederatedGraphName({
      name: federatedGraphName,
      namespace: DEFAULT_NAMESPACE,
      limit: 10,
      offset: 0,
      startDate: oneDayAgo.toISOString(),
      endDate: now.toISOString(),
      filters: {
        subgraphs: [subgraphId!],
      },
    });

    expect(federatedGraphChecksResp.response?.code).toBe(EnumStatusCode.OK);
    expect(federatedGraphChecksResp.checks.length).toBe(1);
    expect(federatedGraphChecksResp.checksCountBasedOnDateRange).toBe(1);

    // Verify the check details for the federated graph
    const federatedGraphCheck = federatedGraphChecksResp.checks[0];
    expect(federatedGraphCheck.checkedSubgraphs.length).toBe(1);
    expect(federatedGraphCheck.checkedSubgraphs[0].subgraphName).toBe(subgraphName);
    expect(federatedGraphCheck.id).toBeDefined();

    // 5. Fetch checks for the contract (which is also a federated graph)
    const contractChecksResp = await client.getChecksByFederatedGraphName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      limit: 10,
      offset: 0,
      startDate: oneDayAgo.toISOString(),
      endDate: now.toISOString(),
      filters: {
        subgraphs: [subgraphId!],
      },
    });

    expect(contractChecksResp.response?.code).toBe(EnumStatusCode.OK);
    expect(contractChecksResp.checks.length).toBe(1);
    expect(contractChecksResp.checksCountBasedOnDateRange).toBe(1);

    // Verify the check details for the contract
    const contractCheck = contractChecksResp.checks[0];
    expect(contractCheck.checkedSubgraphs.length).toBe(1);
    expect(contractCheck.checkedSubgraphs[0].subgraphName).toBe(subgraphName);
    expect(contractCheck.id).toBeDefined();

    // Both the federated graph and the contract should see the same check
    // since they are both linked to the same subgraph, but the check ID should be the same
    // as it's the same schema check operation
    expect(contractCheck.id).toBe(federatedGraphCheck.id);

    // Verify that the check contains information about the subgraph
    expect(federatedGraphCheck.checkedSubgraphs[0].subgraphName).toBe(subgraphName);
    expect(contractCheck.checkedSubgraphs[0].subgraphName).toBe(subgraphName);

    await server.close();
  });
});
