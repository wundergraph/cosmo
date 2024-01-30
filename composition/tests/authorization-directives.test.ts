import { describe, expect, test } from 'vitest';
import {
  AuthorizationData,
  federateSubgraphs,
  FieldAuthorizationData,
  normalizeSubgraphFromString,
  Subgraph,
} from '../src';
import { parse } from 'graphql';
import { documentNodeToNormalizedString, normalizeString, versionTwoPersistedBaseSchema } from './utils/utils';

describe('Authorization Directives Tests', () => {
  describe('Normalization Tests', () => {
    test('that authentication and scopes are inherited correctly', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Query {
          object: Object @authenticated @requiresScopes(scopes: [["read:query"], ["read:object"]])
        }
        type Object @authenticated @requiresScopes(scopes: [["read:object", "read:field"], ["read:all"]]) {
          b: Boolean! @authenticated @requiresScopes(scopes: [["read:bool"], ["read:field"]])
          s: CustomScalar!
         }
         
         scalar CustomScalar @authenticated @requiresScopes(scopes: [["read:field", "read:scalar"], ["read:all"]])
      `);
      expect(errors).toBeUndefined();
      expect(normalizationResult!.authorizationDataByParentTypeName).toStrictEqual(
        new Map<string, AuthorizationData>([
          [
            'Query',
            {
              fieldAuthorizationDataByFieldName: new Map<string, FieldAuthorizationData>([
                [
                  'object',
                  {
                    fieldName: 'object',
                    requiresAuthentication: true,
                    requiredScopes: [new Set<string>(['read:query']), new Set<string>(['read:object'])],
                  },
                ],
              ]),
              hasParentLevelAuthorization: false,
              requiresAuthentication: false,
              requiredScopes: [],
              typeName: 'Query',
            },
          ],
          [
            'Object',
            {
              fieldAuthorizationDataByFieldName: new Map<string, FieldAuthorizationData>([
                [
                  'b',
                  {
                    fieldName: 'b',
                    requiresAuthentication: true,
                    requiredScopes: [
                      new Set<string>(['read:bool', 'read:object', 'read:field']),
                      new Set<string>(['read:bool', 'read:all']),
                      new Set<string>(['read:field', 'read:object']),
                      new Set<string>(['read:field', 'read:all']),
                    ],
                  },
                ],
                [
                  's',
                  {
                    fieldName: 's',
                    requiresAuthentication: true,
                    requiredScopes: [
                      new Set<string>(['read:object', 'read:field', 'read:scalar']),
                      new Set<string>(['read:object', 'read:field', 'read:all']),
                      new Set<string>(['read:all', 'read:field', 'read:scalar']),
                      new Set<string>(['read:all']),
                    ],
                  },
                ],
              ]),
              hasParentLevelAuthorization: true,
              requiresAuthentication: true,
              requiredScopes: [new Set<string>(['read:object', 'read:field']), new Set<string>(['read:all'])],
              typeName: 'Object',
            },
          ],
          [
            'CustomScalar',
            {
              fieldAuthorizationDataByFieldName: new Map<string, FieldAuthorizationData>(),
              hasParentLevelAuthorization: true,
              requiresAuthentication: true,
              requiredScopes: [new Set<string>(['read:field', 'read:scalar']), new Set<string>(['read:all'])],
              typeName: 'CustomScalar',
            },
          ],
        ]),
      );
    });
  });

  describe('Federation Tests', () => {
    test('that @authenticated is persisted in the federated schema', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
        normalizeString(
          versionTwoPersistedBaseSchema +
            `
          type Query {
            object: Object!
          }
          
          type Object {
            id: ID! @authenticated
            name: String! @authenticated
            age: Int!
          }
        `,
        ),
      );
    });

    test('that @requiresScopes is persisted in the federated schema', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphC]);
      expect(errors).toBeUndefined();
      expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
        normalizeString(
          versionTwoPersistedBaseSchema +
            `
          type Object {
            id: ID! @requiresScopes(scopes: [["read:object"]])
            age: Int!
            name: String! @requiresScopes(scopes: [["read:object"]])
          }
          
          type Query {
            object: Object!
          }
        `,
        ),
      );
    });
  });

  describe('Router Configuration Tests', () => {
    test('that authorization directives generate the correct router configuration', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphD]);
      expect(errors).toBeUndefined();
      expect(federationResult!.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'name',
          typeName: 'Object',
          requiresAuthentication: true,
          requiredScopes: [['read:object']],
        },
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'Object',
          requiresAuthentication: false,
          requiredScopes: [['read:object']],
        },
      ]);
    });

    test('that the federated graph and its router configuration are generated correctly', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphE, subgraphF]);
      expect(errors).toBeUndefined();
      expect(federationResult!.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [['read:object']],
        },
        {
          argumentNames: [],
          fieldName: 'name',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [['read:object']],
        },
        {
          argumentNames: [],
          fieldName: 'customScalarTwo',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [],
        },
      ]);
      expect(documentNodeToNormalizedString(federationResult!.federatedGraphAST)).toBe(
        normalizeString(
          versionTwoPersistedBaseSchema +
            `
          type Query {
            entities: [Entity!]!
            customScalar: CustomScalar
            entity: Entity!
            customScalarTwo: CustomScalar @authenticated
          }

          type Entity {
            id: ID! @authenticated @requiresScopes(scopes: [["read:object"]])
            name: String! @authenticated @requiresScopes(scopes: [["read:object"]])
            age: Int!
          }

          scalar CustomScalar
        `,
        ),
      );
    });
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      object: Object!
    }
    
    type Object @key(fields: "id") @authenticated {
      id: ID!
      name: String!
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Object @key(fields: "id") {
      id: ID!
      age: Int!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Query {
      object: Object!
    }
    
    type Object @key(fields: "id") @requiresScopes(scopes: [["read:object"]]) {
      id: ID!
      name: String!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
      type Query {
      object: Object!
    }
    
    type Object @key(fields: "id") @requiresScopes(scopes: [["read:object"]]) {
      id: ID!
      name: String! @authenticated
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Entity!]!
      customScalar: CustomScalar
    }
    
    type Entity @key(fields: "id") @authenticated @requiresScopes(scopes: [["read:object"]]) {
      id: ID!
      name: String!
    }
    
    scalar CustomScalar
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
      customScalarTwo: CustomScalar
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      age: Int!
    }
    
    scalar CustomScalar @authenticated
  `),
};
