import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPromiseClient } from '@connectrpc/connect';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { createConnectTransport } from '@connectrpc/connect-node';
import Fastify from 'fastify';
import pino from 'pino';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Kind, parse } from 'graphql';
import { joinLabel } from '@wundergraph/cosmo-shared';
import {
  ImplementationErrors,
  incompatibleParentKindFatalError,
  InvalidFieldImplementation,
  noQueryRootTypeError,
  unimplementedInterfaceFieldsError,
} from '@wundergraph/composition';
import database from '../src/core/plugins/database';
import routes from '../src/core/routes';
import { composeSubgraphs } from '../src/core/composition/composition';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestAuthenticator,
  genID,
  genUniqueLabel,
  seedTest,
} from '../src/core/test-util';
import Keycloak from '../src/core/services/Keycloak';
import { MockPlatformWebhookService } from '../src/core/webhooks/PlatformWebhookService';

let dbname = '';

describe('CompositionErrors', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should cause a composition error due to extension of the type which doesnt exist', async (testContext) => {
    const databaseConnectionUrl = `postgresql://postgres:changeme@localhost:5432/${dbname}`;
    const server = Fastify();

    await server.register(database, {
      databaseConnectionUrl,
      debugSQL: false,
      runMigration: true,
    });

    testContext.onTestFailed(async () => {
      await server.close();
    });

    const { authenticator, userTestData } = createTestAuthenticator();

    const realm = 'test';
    const apiUrl = 'http://localhost:8080';
    const webBaseUrl = 'http://localhost:3000';
    const clientId = 'studio';
    const adminUser = 'admin';
    const adminPassword = 'changeme';

    const keycloakClient = new Keycloak({
      apiUrl,
      realm,
      clientId,
      adminUser,
      adminPassword,
    });

    const platformWebhooks = new MockPlatformWebhookService();

    await server.register(fastifyConnectPlugin, {
      routes: routes({
        db: server.db,
        logger: pino(),
        authenticator,
        jwtSecret: 'secret',
        keycloakRealm: realm,
        keycloakClient,
        platformWebhooks,
        webBaseUrl,
      }),
    });

    const addr = await server.listen({
      port: 0,
    });

    await seedTest(databaseConnectionUrl, userTestData);

    const transport = createConnectTransport({
      httpVersion: '1.1',
      baseUrl: addr,
    });

    const pandasSchema = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));
    const productsSchema = await readFile(join(process.cwd(), 'test/graphql/federationV1/products.graphql'));
    const inventorySchema = await readFile(join(process.cwd(), 'test/graphql/federationV1/inventory.graphql'));
    const usersSchema = await readFile(join(process.cwd(), 'test/graphql/federationV1/users.graphql'));

    const client = createPromiseClient(PlatformService, transport);
    const federatedGraphName = genID();
    const subgraphName = genID();
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    let resp = await client.createFederatedSubgraph({
      name: 'pandas',
      labels: [label],
      routingUrl: 'http://localhost:8000',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    let publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      schema: pandasSchema,
    });
    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(publishFederatedSubgraphResp.compositionErrors).toStrictEqual([]);

    resp = await client.createFederatedSubgraph({
      name: 'products',
      labels: [label],
      routingUrl: 'http://localhost:8001',
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: 'products',
      schema: productsSchema,
    });
    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(publishFederatedSubgraphResp.compositionErrors[0].message).toBe(
      'Extension error:\n Could not extend the type "User" because no base definition exists.',
    );

    await server.close();
  });

  test('Should cause composition errors on merging a list type with a non-list version', () => {
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

    const result = composeSubgraphs([subgraph1, subgraph2]);
    expect(result.errors).toBeDefined();
    expect(result.errors?.[0].message).toBe(
      'Incompatible types when merging two instances of "A.a":\n Expected type "NamedType" but received "ListType"',
    );
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

    const result = composeSubgraphs([subgraph1, subgraph2]);
    expect(result.errors).toBeDefined();
    expect(result.errors?.[0].message).toBe(
      'Incompatible types when merging two instances of "A.a":\n Expected type "String" but received "Int"',
    );
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

    const result = composeSubgraphs([subgraph1, subgraph2]);
    expect(result.errors).toBeDefined();
    expect(result.errors?.[0].message).toBe(
      'Incompatible types when merging two instances of argument "n" for "Function.g":\n Expected type "Int" but received "String"',
    );
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

    const result = composeSubgraphs([subgraph1, subgraph2]);

    expect(result.errors).toBeDefined();
    expect(result.errors?.[0].message).toBe(
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

    const result = composeSubgraphs([subgraph1, subgraph2]);

    expect(result.errors).toBeDefined();
    expect(result.errors?.[0].message).toBe(
      '[subgraph1] Name "__something" must not begin with "__", which is reserved by GraphQL introspection.',
    );
  });

  test('that an error is returned if the federated graph has no query root type', () => {
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

    const { errors } = composeSubgraphs([subgraph1, subgraph2]);

    expect(errors).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors?.[0]).toStrictEqual(noQueryRootTypeError);
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

    expect(() => composeSubgraphs([subgraph1, subgraph2])).toThrow(
      incompatibleParentKindFatalError('SameName', Kind.OBJECT_TYPE_DEFINITION, Kind.INTERFACE_TYPE_DEFINITION),
    );
  });

  test('Should cause composition errors if a type does not implement one of its interface after merge', () => {
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

    const { errors } = composeSubgraphs([subgraph1, subgraph2]);

    expect(errors).toBeDefined();
    expect(errors![0]).toStrictEqual(
      unimplementedInterfaceFieldsError(
        'TypeB',
        'object',
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

    const result = composeSubgraphs([subgraph1, subgraph2]);
    expect(result.errors).toBeDefined();
    expect(result.errors?.[0].message).toBe(
      'None of the fields of input object type "InputA" are consistently defined in all the subgraphs defining that type. As only fields common to all subgraphs are merged, this would result in an empty type.',
    );
  });

  test.skip('Should cause composition errors if a mandatory input field is not in all subgraphs', () => {
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

    const result = composeSubgraphs([subgraph1, subgraph2]);

    expect(result.errors).toBeDefined();
    expect(result.errors?.[0].message).toBe(
      'Input object field "InputA.b" is required in some subgraphs but does not appear in all subgraphs: it is required in subgraph "subgraph2" but does not appear in subgraph "subgraph1"',
    );
  });
});
