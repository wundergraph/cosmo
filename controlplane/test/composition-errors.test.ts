import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { parse } from 'graphql';
import { joinLabel } from '@wundergraph/cosmo-shared';
import {
  FederationResultFailure,
  ImplementationErrors,
  incompatibleMergedTypesError,
  incompatibleParentKindMergeError,
  INPUT_OBJECT,
  INT_SCALAR,
  INTERFACE,
  InvalidFieldImplementation,
  invalidInterfaceImplementationError,
  invalidRequiredInputValueError,
  LATEST_ROUTER_COMPATIBILITY_VERSION,
  noBaseDefinitionForExtensionError,
  noQueryRootTypeError,
  OBJECT,
  STRING_SCALAR,
} from '@wundergraph/composition';
import { composeSubgraphs } from '../src/core/composition/composition.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Composition error tests', (ctx) => {
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

  test('that an error is returned if an Object extension orphan remains after federation', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const pandasSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));
    const productsSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/products.graphql'));

    const pandasSchema = new TextDecoder().decode(pandasSchemaBuffer);
    const productsSchema = new TextDecoder().decode(productsSchemaBuffer);

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
      schema: pandasSchema,
    });
    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(publishFederatedSubgraphResp.compositionErrors).toStrictEqual([]);

    resp = await client.createFederatedSubgraph({
      name: 'products',
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8001',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: 'products',
      namespace: 'default',
      schema: productsSchema,
    });
    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(publishFederatedSubgraphResp.compositionErrors[0].message).toStrictEqual(
      noBaseDefinitionForExtensionError(OBJECT, 'User').message,
    );

    await server.close();
  });

  test('that an error is returned when attempting federate a List type with a non-List type', () => {
    const subgraph1 = {
      name: 'subgraph1',
      url: '',
      definitions: parse(`
        type Query {
          A: A!
        }

        type A @key(fields: "id") {
          id: ID!
          a: String
        }
      `),
    };

    const subgraph2 = {
      name: 'subgraph2',
      url: '',
      definitions: parse(`
        type A @key(fields: "id") {
          id: ID!
          a: [String]
        }
      `),
    };

    const result = composeSubgraphs([subgraph1, subgraph2], LATEST_ROUTER_COMPATIBILITY_VERSION) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(incompatibleMergedTypesError({
      actualType: 'ListType',
      coords:'A.a',
      expectedType: 'NamedType',
    }));
  });

  test('Should cause composition errors on incompatible input field types', () => {
    const subgraph1 = {
      name: 'subgraph1',
      url: '',
      definitions: parse(`
        type Query {
          name: String
        }

        input A {
          a: String
        }
      `),
    };

    const subgraph2 = {
      name: 'subgraph2',
      url: '',
      definitions: parse(`
        input A {
          a: Int
        }
      `),
    };

    const result = composeSubgraphs([subgraph1, subgraph2], LATEST_ROUTER_COMPATIBILITY_VERSION) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(incompatibleMergedTypesError({
      actualType: 'Int',
      coords: 'A.a',
      expectedType: 'String',
    }));
  });

  test('Should cause composition errors on incompatible types of function arguments', () => {
    const subgraph1 = {
      name: 'subgraph1',
      url: '',
      definitions: parse(`
        type Query {
          A: Function!
        }

        type Function @key(fields: "id") {
          id: ID!
          g(n: Int): Int
        }
      `),
    };

    const subgraph2 = {
      name: 'subgraph2',
      url: '',
      definitions: parse(`
        type Function @key(fields: "id") {
          id: ID!
          g(n: String): Int
        }
      `),
    };

    const result = composeSubgraphs([subgraph1, subgraph2], LATEST_ROUTER_COMPATIBILITY_VERSION) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(incompatibleMergedTypesError({
      actualType: STRING_SCALAR,
      coords: 'Function.g(n: ...)',
      expectedType: INT_SCALAR,
      isArgument: true,
    }));
  });

  test.skip('Should cause composition errors when the @tag definition is invalid', () => {
    const subgraph1 = {
      definitions: parse(`
        directive @tag on FIELD_DEFINITION

        type Query {
          a: String
        }
      `),
      url: '',
      name: 'subgraph1',
    };

    const subgraph2 = {
      definitions: parse(`
        type Something {
          b: String
        }
      `),
      url: '',
      name: 'subgraph2',
    };

    const result = composeSubgraphs([subgraph1, subgraph2], LATEST_ROUTER_COMPATIBILITY_VERSION) as FederationResultFailure;

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe(
      '[subgraph1] Invalid definition for directive "@tag": missing required argument "name"',
    );
  });

  test.skip('Should cause composition errors when a subgraph has a field with a reserved name', () => {
    const subgraph1 = {
      definitions: parse(`
        type Query {
          __something: String
        }
      `),
      url: '',
      name: 'subgraph1',
    };

    const subgraph2 = {
      definitions: parse(`
        type Query {
          a: Int
        }
      `),
      url: '',
      name: 'subgraph2',
    };

    const result = composeSubgraphs([subgraph1, subgraph2], LATEST_ROUTER_COMPATIBILITY_VERSION) as FederationResultFailure;

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe(
      '[subgraph1] Name "__something" must not begin with "__", which is reserved by GraphQL introspection.',
    );
  });

  test('Should cause an error is returned if the federated graph has no query root type', () => {
    const subgraph1 = {
      definitions: parse(`
        type TypeA {
          a: String
        }
      `),
      url: '',
      name: 'subgraph1',
    };

    const subgraph2 = {
      definitions: parse(`
        type TypeB {
          b: Int
        }
      `),
      url: '',
      name: 'subgraph2',
    };

    const result = composeSubgraphs([subgraph1, subgraph2], LATEST_ROUTER_COMPATIBILITY_VERSION) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]).toStrictEqual(noQueryRootTypeError());
  });

  test('Should cause an composition error when a type and a interface are defined with the same name in different subgraphs', () => {
    const subgraph1 = {
      definitions: parse(`
        type Query {
          q: SameName
        }

        type SameName {
          a: Int
        }
      `),
      url: '',
      name: 'subgraph1',
    };

    const subgraph2 = {
      definitions: parse(`
        interface SameName {
          b: String
        }
      `),
      url: '',
      name: 'subgraph2',
    };

    const result = composeSubgraphs([subgraph1, subgraph2], LATEST_ROUTER_COMPATIBILITY_VERSION) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(incompatibleParentKindMergeError('SameName', OBJECT, INTERFACE));
  });

  test('that composition errors are returned if a type does not satisfy its implemented Interfaces after federation', () => {
    const subgraph1 = {
      definitions: parse(`
        type Query {
          x: [InterfaceA!]
        }

        interface InterfaceA {
          a: Int
        }

        type TypeA implements InterfaceA {
          a: Int
          b: Int
        }
      `),
      url: '',
      name: 'subgraph1',
    };

    const subgraph2 = {
      definitions: parse(`
        interface InterfaceA {
          b: Int
        }

        type TypeB implements InterfaceA {
          b: Int
        }
      `),
      url: '',
      name: 'subgraph2',
    };

    const result = composeSubgraphs([subgraph1, subgraph2], LATEST_ROUTER_COMPATIBILITY_VERSION) as FederationResultFailure;

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toStrictEqual(
      invalidInterfaceImplementationError(
        'TypeB',
        OBJECT,
        new Map<string, ImplementationErrors>([
          [
            'InterfaceA',
            {
              invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
              unimplementedFields: ['a'],
            },
          ],
        ]),
      ),
    );
  });

  test.skip('Should cause composition errors when merging completely inconsistent input types', () => {
    const subgraph1 = {
      name: 'subgraph1',
      definitions: parse(`
        type Query {
          g(n: InputA!): String
        }

        input InputA {
          x: String
        }
      `),
      url: '',
    };

    const subgraph2 = {
      name: 'subgraph2',
      definitions: parse(`
        input InputA {
          y: String
        }
      `),
      url: '',
    };

    const result = composeSubgraphs([subgraph1, subgraph2], LATEST_ROUTER_COMPATIBILITY_VERSION) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0].message).toBe(
      'None of the fields of input object type "InputA" are consistently defined in all the subgraphs defining that type. As only fields common to all subgraphs are merged, this would result in an empty type.',
    );
  });

  test('that a required input field must always be present', () => {
    const subgraph1 = {
      definitions: parse(`
        type Query {
          g(a: InputA): Int
        }

        input InputA {
          a: String
        }
      `),
      url: '',
      name: 'subgraph1',
    };

    const subgraph2 = {
      definitions: parse(`
        type Query {
          f(a: InputA): Int
        }

        input InputA {
          a: String
          b: Int!
        }
      `),
      url: '',
      name: 'subgraph2',
    };

    const result = composeSubgraphs([subgraph1, subgraph2], LATEST_ROUTER_COMPATIBILITY_VERSION) as FederationResultFailure;
    expect(result.success).toBe(false);
    expect(result.errors[0]).toStrictEqual(
      invalidRequiredInputValueError(
        INPUT_OBJECT,
        'InputA',
        [{ inputValueName: 'b', missingSubgraphs: ['subgraph1'], requiredSubgraphs: ['subgraph2'] }],
        false,
      ),
    );
  });
});
