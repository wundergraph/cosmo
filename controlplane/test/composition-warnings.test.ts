import {
  externalInterfaceFieldsWarning, FieldSetDirective,
  invalidOverrideTargetSubgraphNameWarning,
  N_A, nonExternalConditionalFieldWarning,
} from '@wundergraph/composition';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { parse } from 'graphql/index.js';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { composeSubgraphs } from '../src/core/composition/composition.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';
describe('Composition warning tests', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that an warnings is returned if a field is override from a subgraph that doesnt exist', async () => {
    const { client, server } = await SetupTest({ dbname });

    const federatedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    const resp = await client.createFederatedSubgraph({
      name: 'pandas',
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8000',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      namespace: 'default',
      schema: `type Query { hello: String! @override(from: "employees") }`,
    });
    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(publishFederatedSubgraphResp.compositionWarnings).toHaveLength(1);
    expect(publishFederatedSubgraphResp.compositionWarnings[0].message).toBe(
      invalidOverrideTargetSubgraphNameWarning('employees', 'Query', ['hello']).message,
    );

    await server.close();
  });

  test('that an warning is returned if a V1 interface extension field is declared @external', async () => {
    const { client, server } = await SetupTest({ dbname });

    const federatedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    const resp = await client.createFederatedSubgraph({
      name: 'pandas',
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8000',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      namespace: 'default',
      schema: `
          type Query {
            name: String!
          }

          interface Interface {
            age: Int! @external
            id: ID! @external
          }
        `,
    });
    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(publishFederatedSubgraphResp.compositionWarnings).toHaveLength(1);
    expect(publishFederatedSubgraphResp.compositionWarnings[0].message).toBe(
      externalInterfaceFieldsWarning('pandas', 'Interface', ['age', 'id']).message,
    );

    await server.close();
  });

  test('that an warning is returned if a non-external v1 fields are a part of a @requires field set', async () => {
    const { client, server } = await SetupTest({ dbname });

    const federatedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    let resp = await client.createFederatedSubgraph({
      name: 'pandas',
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8000',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    let publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      namespace: 'default',
      schema: `
      schema {
      query: Queries  
    }
    
    type Queries {
      entity: Entity!
    }
    
    type Entity @key(fields: "id object { nestedObject { id } }") @key(fields: "id object { nestedObject { name } }") {
      id: ID!
      object: Object!
      age: Int!
    }
    
    type Object {
      nestedObject: NestedObject!
    }
    
    type NestedObject {
      id: ID!
      name: String!
    }
        `,
    });
    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

     resp = await client.createFederatedSubgraph({
      name: 'products',
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8000',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

     publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: 'products',
      namespace: 'default',
      schema: `
          type Entity @key(fields: "id") {
      id: ID!
      name: String! @requires(fields: "object { nestedObject { name } }")
      object: Object!
    }
    
    type Object {
      nestedObject: NestedObject!
    }
    
    type NestedObject {
      id: ID!
      name: String!
    }
        `,
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(publishFederatedSubgraphResp.compositionWarnings).toHaveLength(1);
    expect(publishFederatedSubgraphResp.compositionWarnings[0].message).toBe(
      nonExternalConditionalFieldWarning(
        'Entity.name',
        'products',
        'NestedObject.name',
        'object { nestedObject { name } }',
        FieldSetDirective.REQUIRES,
      ).message,
    );

    await server.close();
  });
});
