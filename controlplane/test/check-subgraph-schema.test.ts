import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { SchemaChangeType } from '../src/types/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('CheckSubgraphSchema', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create a subgraph, publish the schema and then check with new schema', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();

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
      schema: 'type Query { hello: String! }',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    // test for no changes in schema
    let checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.breakingChanges.length).toBe(0);
    expect(checkResp.nonBreakingChanges.length).toBe(0);

    // test for breaking changes in schema
    checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { name: String! }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.breakingChanges.length).not.toBe(0);
    expect(checkResp.breakingChanges[0].changeType).toBe(SchemaChangeType.FIELD_REMOVED);
    expect(checkResp.nonBreakingChanges.length).not.toBe(0);
    expect(checkResp.nonBreakingChanges[0].changeType).toBe(SchemaChangeType.FIELD_ADDED);

    await server.close();
  });

  test('Should be able to create a federated graph,subgraph, publish the schema and then check the new schema for composition errors', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

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
      schema: 'type Query { hello: String! }',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! } extend type Product { hello: String! }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors.length).not.toBe(0);
    expect(checkResp.compositionErrors[0].message).toBe(
      `Extension error:\n Could not extend the type "Product" because no base definition exists.`,
    );

    await server.close();
  });

  test('Should be able to create a federated graph,subgraph and then perform the check operation on the subgragh with valid schema ', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

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

    const resp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const checkResp = await client.checkSubgraphSchema({
      subgraphName,
      namespace: 'default',
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors.length).toBe(0);
    expect(checkResp.breakingChanges.length).toBe(0);

    await server.close();
  });
});
