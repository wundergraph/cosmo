import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GraphPruningConfig,
  GraphPruningIssue,
  LintSeverity
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { pino } from 'pino';
import { Mock, afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { NamespaceRepository } from '../src/core/repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../src/core/repositories/SubgraphRepository.js';
import { TestUser, afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

const initSchema = `type Query { 
  hello: Hello! 
}

type Hello { 
  name: String! 
  age: Int! 
  a: String @deprecated
  field: String @deprecated
  removedField: String
}
`;

const modifiedSchema1 = `type Query { 
  hello: Hello! 
}

type Hello { 
  name: String! 
  age: Int!
  a: String @deprecated
  newField: String
}
`;

const modifiedSchema2 = `type Query { 
  hello: Hello! 
}

type Hello { 
  name: String! 
  age: Int!
  a: String @deprecated
  b: String @deprecated
}
`;

const modifiedSchema3 = `type Query { 
  hello: Hello! 
}

type Hello { 
  name: String! 
  age: Int!
  a: String @deprecated
  b: String
}
`;

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Graph Pruning Tests', (ctx) => {
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

  test('Should enable graph pruning', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'launch@1' } });
    const response = await client.enableGraphPruning({
      enableGraphPruning: true,
      namespace: 'default',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should not be able to enable graph pruning', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'developer@1' } });
    const response = await client.enableGraphPruning({
      enableGraphPruning: true,
      namespace: 'default',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Upgrade to a paid plan to enable graph pruning');

    await server.close();
  });

  test('users without write access should not be able to enable graph pruning', async (testContext) => {
    const { client, authenticator, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
      enableMultiUsers: true,
    });

    authenticator.changeUser(TestUser.viewerTimCompanyA);

    const response = await client.enableGraphPruning({
      enableGraphPruning: true,
      namespace: 'default',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(response.response?.details).toBe('The user does not have the permissions to perform this operation');

    await server.close();
  });

  test('Should configure graph pruning config', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'launch@1' } });
    const response = await client.enableGraphPruning({
      enableGraphPruning: true,
      namespace: 'default',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    let getNamespaceGraphPruningConfigResponse = await client.getNamespaceGraphPruningConfig({
      namespace: 'default',
    });

    expect(getNamespaceGraphPruningConfigResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getNamespaceGraphPruningConfigResponse.graphPrunerEnabled).toBe(true);
    expect(getNamespaceGraphPruningConfigResponse.configs).toStrictEqual([]);

    const graphPruningConfigs = [
      new GraphPruningConfig({
        ruleName: 'UNUSED_FIELDS',
        severityLevel: LintSeverity.error,
        gracePeriodInDays: 7,
      }),
      new GraphPruningConfig({
        ruleName: 'DEPRECATED_FIELDS',
        severityLevel: LintSeverity.warn,
        gracePeriodInDays: 7,
      }),
      new GraphPruningConfig({
        ruleName: 'REQUIRE_DEPRECATION_BEFORE_DELETION',
        severityLevel: LintSeverity.warn,
        gracePeriodInDays: 7,
      }),
    ];

    const configureGraphPruningConfigResponse = await client.configureNamespaceGraphPruningConfig({
      namespace: 'default',
      configs: graphPruningConfigs,
    });

    expect(configureGraphPruningConfigResponse.response?.code).toBe(EnumStatusCode.OK);
    getNamespaceGraphPruningConfigResponse = await client.getNamespaceGraphPruningConfig({
      namespace: 'default',
    });

    expect(getNamespaceGraphPruningConfigResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getNamespaceGraphPruningConfigResponse.graphPrunerEnabled).toBe(true);
    expect(getNamespaceGraphPruningConfigResponse.configs).toEqual(graphPruningConfigs);

    await server.close();
  });

  test('users without write access should not be able to configure graph pruning config', async (testContext) => {
    const { client, authenticator, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
      enableMultiUsers: true,
    });
    const response = await client.enableGraphPruning({
      enableGraphPruning: true,
      namespace: 'default',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    authenticator.changeUser(TestUser.viewerTimCompanyA);

    const graphPruningConfigs = [
      new GraphPruningConfig({
        ruleName: 'UNUSED_FIELDS',
        severityLevel: LintSeverity.error,
        gracePeriodInDays: 7,
      }),
      new GraphPruningConfig({
        ruleName: 'DEPRECATED_FIELDS',
        severityLevel: LintSeverity.warn,
        gracePeriodInDays: 7,
      }),
      new GraphPruningConfig({
        ruleName: 'REQUIRE_DEPRECATION_BEFORE_DELETION',
        severityLevel: LintSeverity.warn,
        gracePeriodInDays: 7,
      }),
    ];

    const configureGraphPruningConfigResponse = await client.configureNamespaceGraphPruningConfig({
      namespace: 'default',
      configs: graphPruningConfigs,
    });

    expect(configureGraphPruningConfigResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(configureGraphPruningConfigResponse.response?.details).toBe(
      'The user does not have the permissions to perform this operation',
    );

    await server.close();
  });

  test('Should configure graph pruning config, run check subgraph command and verify the results', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'launch@1' }, chClient });

    const federatedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    let resp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: initSchema,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const response = await client.enableGraphPruning({
      enableGraphPruning: true,
      namespace: 'default',
    });
    expect(response.response?.code).toBe(EnumStatusCode.OK);

    const graphPruningConfigs = [
      new GraphPruningConfig({
        ruleName: 'UNUSED_FIELDS',
        severityLevel: LintSeverity.error,
        gracePeriodInDays: 7,
      }),
      new GraphPruningConfig({
        ruleName: 'DEPRECATED_FIELDS',
        severityLevel: LintSeverity.warn,
        gracePeriodInDays: 7,
      }),
      new GraphPruningConfig({
        ruleName: 'REQUIRE_DEPRECATION_BEFORE_DELETION',
        severityLevel: LintSeverity.warn,
        gracePeriodInDays: 7,
      }),
    ];

    const configureGraphPruningConfigResponse = await client.configureNamespaceGraphPruningConfig({
      namespace: 'default',
      configs: graphPruningConfigs,
    });
    expect(configureGraphPruningConfigResponse.response?.code).toBe(EnumStatusCode.OK);

    (chClient.queryPromise as Mock)
      .mockResolvedValueOnce([
        {
          operationHash: 'hash1',
          operationName: 'op1',
          operationType: 'query',
          firstSeen: Date.now() / 1000,
          lastSeen: Date.now() / 1000,
        },
      ])
      .mockResolvedValueOnce([
        {
          operationHash: 'hash1',
          operationName: 'op1',
          operationType: 'query',
          firstSeen: Date.now() / 1000,
          lastSeen: Date.now() / 1000,
        },
      ])
      .mockResolvedValueOnce([
        {
          name: 'a',
          typeName: 'Hello',
        },
      ])
      .mockResolvedValueOnce([
        {
          name: 'hello',
          typeName: 'Query',
        },
        {
          name: 'name',
          typeName: 'Hello',
        },
        {
          name: 'age',
          typeName: 'Hello',
        },
      ]);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Buffer.from(modifiedSchema1),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.breakingChanges.length).toBe(2);
    expect(checkResp.graphPruneErrors).toHaveLength(1);
    expect(checkResp.graphPruneErrors).toEqual([
      new GraphPruningIssue({
        federatedGraphName,
        fieldPath: 'Hello.a',
        graphPruningRuleType: 'UNUSED_FIELDS',
        issueLocation: {
          column: 3,
          endColumn: 14,
          endLine: 8,
          line: 8,
        },
        message: 'Field a of type Hello has not been used in the past 7 days',
        severity: LintSeverity.error,
      }),
    ]);
    expect(checkResp.graphPruneWarnings).toHaveLength(2);
    expect(checkResp.graphPruneWarnings).toEqual([
      new GraphPruningIssue({
        federatedGraphName,
        fieldPath: 'Hello.a',
        graphPruningRuleType: 'DEPRECATED_FIELDS',
        issueLocation: {
          column: 3,
          endColumn: 14,
          endLine: 8,
          line: 8,
        },
        message:
          'Field a of type Hello was deprecated, is no longer in use, and is now safe for removal following the expiration of the grace period.',
        severity: LintSeverity.warn,
      }),
      new GraphPruningIssue({
        federatedGraphName,
        fieldPath: 'Hello.removedField',
        graphPruningRuleType: 'REQUIRE_DEPRECATION_BEFORE_DELETION',
        issueLocation: {
          column: 0,
          endColumn: 0,
          endLine: 0,
          line: 0,
        },
        message: 'Field removedField of type Hello was removed without being deprecated first.',
        severity: LintSeverity.warn,
      }),
    ]);

    await server.close();
  });

  test('Should store grace fields when published after graph pruning is enabled', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, setupBilling: { plan: 'launch@1' }, chClient });

    const federatedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    let resp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: initSchema,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    const response = await client.enableGraphPruning({
      enableGraphPruning: true,
      namespace: 'default',
    });
    expect(response.response?.code).toBe(EnumStatusCode.OK);

    const graphPruningConfigs = [
      new GraphPruningConfig({
        ruleName: 'UNUSED_FIELDS',
        severityLevel: LintSeverity.error,
        gracePeriodInDays: 7,
      }),
      new GraphPruningConfig({
        ruleName: 'DEPRECATED_FIELDS',
        severityLevel: LintSeverity.warn,
        gracePeriodInDays: 7,
      }),
      new GraphPruningConfig({
        ruleName: 'REQUIRE_DEPRECATION_BEFORE_DELETION',
        severityLevel: LintSeverity.warn,
        gracePeriodInDays: 7,
      }),
    ];

    const configureGraphPruningConfigResponse = await client.configureNamespaceGraphPruningConfig({
      namespace: 'default',
      configs: graphPruningConfigs,
    });
    expect(configureGraphPruningConfigResponse.response?.code).toBe(EnumStatusCode.OK);

    let publishResponse = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: modifiedSchema1,
    });
    expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

    const subgraphRepo = new SubgraphRepository(pino(), server.db, users.adminAliceCompanyA.organizationId);
    const namespaceRepo = new NamespaceRepository(server.db, users.adminAliceCompanyA.organizationId);
    const namespace = await namespaceRepo.byName('default');
    expect(namespace).toBeDefined();

    const subgraph = await subgraphRepo.byName(subgraphName, 'default');
    expect(subgraph).toBeDefined();

    let graceFields = await subgraphRepo.getSubgraphFieldsInGracePeriod({
      namespaceId: namespace!.id,
      subgraphId: subgraph!.id,
      onlyDeprecated: false,
    });

    expect(graceFields).toHaveLength(1);
    expect(graceFields[0].path).toBe('Hello.newField');
    expect(graceFields[0].isDeprecated).toBe(false);

    publishResponse = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: modifiedSchema2,
    });
    expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

    // in the above publish a field called b is added and is deprecated, but if its added with deprecation, we dont get added deprecation change. So only one grace period
    graceFields = await subgraphRepo.getSubgraphFieldsInGracePeriod({
      namespaceId: namespace!.id,
      subgraphId: subgraph!.id,
      onlyDeprecated: false,
    });

    expect(graceFields).toHaveLength(1);
    expect(graceFields[0].path).toBe('Hello.b');
    expect(graceFields[0].isDeprecated).toBe(false);

    // this publish removes the deprecation from b
    publishResponse = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: modifiedSchema3,
    });
    expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

    graceFields = await subgraphRepo.getSubgraphFieldsInGracePeriod({
      namespaceId: namespace!.id,
      subgraphId: subgraph!.id,
      onlyDeprecated: false,
    });

    expect(graceFields).toHaveLength(1);
    expect(graceFields[0].path).toBe('Hello.b');
    expect(graceFields[0].isDeprecated).toBe(false);

    // this publish adds the deprecation to b, so the grace period fields will be 2, the same field b with and without deprecation
    publishResponse = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: modifiedSchema2,
    });
    expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

    graceFields = await subgraphRepo.getSubgraphFieldsInGracePeriod({
      namespaceId: namespace!.id,
      subgraphId: subgraph!.id,
      onlyDeprecated: false,
    });

    expect(graceFields).toHaveLength(2);

    graceFields = await subgraphRepo.getSubgraphFieldsInGracePeriod({
      namespaceId: namespace!.id,
      subgraphId: subgraph!.id,
      onlyDeprecated: true,
    });

    expect(graceFields).toHaveLength(1);
    expect(graceFields[0].path).toBe('Hello.b');
    expect(graceFields[0].isDeprecated).toBe(true);

    await server.close();
  });
});
