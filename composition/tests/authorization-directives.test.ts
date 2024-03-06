import { describe, expect, test } from 'vitest';
import {
  AuthorizationData,
  federateSubgraphs,
  FieldAuthorizationData,
  maxOrScopes,
  normalizeSubgraphFromString,
  orScopesLimitError,
  Subgraph,
} from '../src';
import { parse } from 'graphql';
import {
  normalizeString,
  schemaToSortedNormalizedString,
  versionTwoPersistedDirectiveDefinitions,
  versionTwoSchemaQueryAndPersistedDirectiveDefinitions,
} from './utils/utils';

describe('Authorization directives tests', () => {
  describe('Normalization Tests', () => {
    test('that authentication and scopes are inherited correctly', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Query {
          object: Object @authenticated @requiresScopes(scopes: [["read:query"], ["read:object"]])
        }
        type Object @authenticated @requiresScopes(scopes: [["read:object", "read:field"], ["read:all"]]) {
          b: Boolean! @authenticated @requiresScopes(scopes: [["read:bool"], ["read:field"]])
          s: Scalar!
         }
         
         scalar Scalar @authenticated @requiresScopes(scopes: [["read:field", "read:scalar"], ["read:all"]])
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
            'Scalar',
            {
              fieldAuthorizationDataByFieldName: new Map<string, FieldAuthorizationData>(),
              hasParentLevelAuthorization: true,
              requiresAuthentication: true,
              requiredScopes: [new Set<string>(['read:field', 'read:scalar']), new Set<string>(['read:all'])],
              typeName: 'Scalar',
            },
          ],
        ]),
      );
    });

    test('that an error is returned if the limit of @requiresScopes scopes is exceeded #1', () => {
      const { errors } = normalizeSubgraphFromString(`
        type Query @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"], ["i"], ["j"], ["k"], ["l"], ["m"], ["n"], ["o"], ["p"], ["q"]]) {
          enum: Enum!
          scalar: Scalar!
        }
        
        interface Interface @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"], ["i"], ["j"], ["k"], ["l"], ["m"], ["n"], ["o"], ["p"], ["q"]]) {
          name: String!
        }
        
        type Object implements Interface {
          name: String!
        }
        
        enum Enum @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"], ["i"], ["j"], ["k"], ["l"], ["m"], ["n"], ["o"], ["p"], ["q"]]) {
          VALUE
        }
        
        scalar Scalar @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"], ["i"], ["j"], ["k"], ["l"], ["m"], ["n"], ["o"], ["p"], ["q"]])
      `);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(orScopesLimitError(maxOrScopes, ['Enum', 'Scalar', 'Query', 'Interface']));
    });

    test('that an error is returned if the limit of @requiresScopes scopes is exceeded #2', () => {
      const { errors } = normalizeSubgraphFromString(`
        type Query @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"]]) {
          enum: Enum!
          scalar: Scalar!
        }
        
        interface Interface @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"]]) {
          name: String!
        }
        
        type Object implements Interface @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"]]) {
          name: String!
        }
        
        enum Enum @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"]]) {
          VALUE
        }
        
        scalar Scalar @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"]])
      `);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(orScopesLimitError(maxOrScopes, ['Query.enum', 'Query.scalar', 'Object.name']));
    });
  });

  describe('Federation Tests', () => {
    test('that @authenticated is persisted in the federated schema', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
          type Object {
            age: Int!
            id: ID! @authenticated
            name: String! @authenticated
          }
          
          type Query {
            object: Object!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that @requiresScopes is persisted in the federated schema', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphC]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
          type Object {
            age: Int!
            id: ID! @requiresScopes(scopes: [["read:object"]])
            name: String! @requiresScopes(scopes: [["read:object"]])
          }
          
          type Query {
            object: Object!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that an error is returned if the limit of @requiresScopes scopes is exceeded after federation #1.1', () => {
      const { errors } = federateSubgraphs([subgraphK, subgraphL]);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(orScopesLimitError(maxOrScopes, ['Query.entity', 'Entity.id', 'Entity.enum']));
    });

    test('that an error is returned if the limit of @requiresScopes scopes is exceeded after federation #1.2', () => {
      const { errors } = federateSubgraphs([subgraphL, subgraphK]);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(orScopesLimitError(maxOrScopes, ['Query.entity', 'Entity.id', 'Entity.enum']));
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
          fieldName: 'scalarTwo',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [],
        },
      ]);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          `
        schema {
          query: Query
        }` +
            versionTwoPersistedDirectiveDefinitions +
            `
        type Entity {
          age: Int!
          id: ID! @authenticated @requiresScopes(scopes: [["read:object"]])
          name: String! @authenticated @requiresScopes(scopes: [["read:object"]])
        }
        
        type Query {
          entities: [Entity!]!
          entity: Entity!
          scalar: Scalar
          scalarTwo: Scalar @authenticated
        }

        scalar Scalar
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly for interfaces #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphG, subgraphH]);
      expect(errors).toBeUndefined();
      expect(federationResult!.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Query',
          requiresAuthentication: false,
          requiredScopes: [['read:scalar']],
        },
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'Interface',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:interface', 'read:private', 'read:sensitive', 'read:field'],
            ['read:interface', 'read:private', 'read:field'],
            ['read:all', 'read:sensitive', 'read:field'],
            ['read:all', 'read:private', 'read:field'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Interface',
          requiresAuthentication: false,
          requiredScopes: [
            ['read:interface', 'read:private', 'read:scalar'],
            ['read:all', 'read:scalar'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'age',
          typeName: 'Interface',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:sensitive', 'read:field'],
            ['read:private', 'read:field'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'scalarTwo',
          typeName: 'Interface',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:sensitive', 'read:field', 'read:scalars'],
            ['read:private', 'read:field', 'read:scalars'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Entity',
          requiresAuthentication: false,
          requiredScopes: [
            ['read:scalar', 'read:interface', 'read:private'],
            ['read:scalar', 'read:all'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:interface', 'read:private', 'read:object', 'read:sensitive', 'read:field'],
            ['read:interface', 'read:private', 'read:object', 'read:field'],
            ['read:interface', 'read:private', 'read:all', 'read:sensitive', 'read:field'],
            ['read:interface', 'read:private', 'read:all', 'read:field'],
            ['read:all', 'read:object', 'read:sensitive', 'read:field'],
            ['read:all', 'read:object', 'read:private', 'read:field'],
            ['read:all', 'read:sensitive', 'read:field'],
            ['read:all', 'read:private', 'read:field'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'age',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:object', 'read:sensitive', 'read:field'],
            ['read:object', 'read:private', 'read:field'],
            ['read:all', 'read:sensitive', 'read:field'],
            ['read:all', 'read:private', 'read:field'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'scalarTwo',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:object', 'read:scalars', 'read:sensitive', 'read:field'],
            ['read:object', 'read:scalars', 'read:private', 'read:field'],
            ['read:all', 'read:scalars', 'read:sensitive', 'read:field'],
            ['read:all', 'read:scalars', 'read:private', 'read:field'],
          ],
        },
      ]);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
        type Entity implements Interface {
          age: Int! @authenticated @requiresScopes(scopes: [["read:object", "read:sensitive", "read:field"], ["read:object", "read:private", "read:field"], ["read:all", "read:sensitive", "read:field"], ["read:all", "read:private", "read:field"]])
          id: ID! @requiresScopes(scopes: [["read:interface", "read:private", "read:object", "read:sensitive", "read:field"], ["read:interface", "read:private", "read:object", "read:field"], ["read:interface", "read:private", "read:all", "read:sensitive", "read:field"], ["read:interface", "read:private", "read:all", "read:field"], ["read:all", "read:object", "read:sensitive", "read:field"], ["read:all", "read:object", "read:private", "read:field"], ["read:all", "read:sensitive", "read:field"], ["read:all", "read:private", "read:field"]]) @authenticated
          scalar: Scalar! @requiresScopes(scopes: [["read:scalar", "read:interface", "read:private"], ["read:scalar", "read:all"]])
          scalarTwo: Scalar! @authenticated @requiresScopes(scopes: [["read:object", "read:scalars", "read:sensitive", "read:field"], ["read:object", "read:scalars", "read:private", "read:field"], ["read:all", "read:scalars", "read:sensitive", "read:field"], ["read:all", "read:scalars", "read:private", "read:field"]])
        }
        
        interface Interface {
          age: Int! @authenticated @requiresScopes(scopes: [["read:sensitive", "read:field"], ["read:private", "read:field"]])
          id: ID! @requiresScopes(scopes: [["read:interface", "read:private", "read:sensitive", "read:field"], ["read:interface", "read:private", "read:field"], ["read:all", "read:sensitive", "read:field"], ["read:all", "read:private", "read:field"]]) @authenticated
          scalar: Scalar! @requiresScopes(scopes: [["read:interface", "read:private", "read:scalar"], ["read:all", "read:scalar"]])
          scalarTwo: Scalar! @authenticated @requiresScopes(scopes: [["read:sensitive", "read:field", "read:scalars"], ["read:private", "read:field", "read:scalars"]])
        }
        
        type Query {
          entity: Entity!
          scalar: Scalar! @requiresScopes(scopes: [["read:scalar"]])
        }

        scalar Scalar
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly for interfaces #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphH, subgraphG]);
      expect(errors).toBeUndefined();
      expect(federationResult!.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'Interface',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:sensitive', 'read:field', 'read:interface', 'read:private'],
            ['read:sensitive', 'read:field', 'read:all'],
            ['read:private', 'read:field', 'read:interface'],
            ['read:private', 'read:field', 'read:all'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'age',
          typeName: 'Interface',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:sensitive', 'read:field'],
            ['read:private', 'read:field'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'scalarTwo',
          typeName: 'Interface',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:sensitive', 'read:field', 'read:scalars'],
            ['read:private', 'read:field', 'read:scalars'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Interface',
          requiresAuthentication: false,
          requiredScopes: [
            ['read:interface', 'read:private', 'read:scalar'],
            ['read:all', 'read:scalar'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:object', 'read:sensitive', 'read:field', 'read:interface', 'read:private'],
            ['read:object', 'read:sensitive', 'read:field', 'read:all'],
            ['read:object', 'read:private', 'read:field', 'read:interface'],
            ['read:object', 'read:private', 'read:field', 'read:all'],
            ['read:all', 'read:sensitive', 'read:field', 'read:interface', 'read:private'],
            ['read:all', 'read:sensitive', 'read:field'],
            ['read:all', 'read:private', 'read:field', 'read:interface'],
            ['read:all', 'read:private', 'read:field'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'age',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:object', 'read:sensitive', 'read:field'],
            ['read:object', 'read:private', 'read:field'],
            ['read:all', 'read:sensitive', 'read:field'],
            ['read:all', 'read:private', 'read:field'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'scalarTwo',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:object', 'read:scalars', 'read:sensitive', 'read:field'],
            ['read:object', 'read:scalars', 'read:private', 'read:field'],
            ['read:all', 'read:scalars', 'read:sensitive', 'read:field'],
            ['read:all', 'read:scalars', 'read:private', 'read:field'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Entity',
          requiresAuthentication: false,
          requiredScopes: [
            ['read:scalar', 'read:interface', 'read:private'],
            ['read:scalar', 'read:all'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Query',
          requiresAuthentication: false,
          requiredScopes: [['read:scalar']],
        },
      ]);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
        type Entity implements Interface {
          age: Int! @authenticated @requiresScopes(scopes: [["read:object", "read:sensitive", "read:field"], ["read:object", "read:private", "read:field"], ["read:all", "read:sensitive", "read:field"], ["read:all", "read:private", "read:field"]])
          id: ID! @authenticated @requiresScopes(scopes: [["read:object", "read:sensitive", "read:field", "read:interface", "read:private"], ["read:object", "read:sensitive", "read:field", "read:all"], ["read:object", "read:private", "read:field", "read:interface"], ["read:object", "read:private", "read:field", "read:all"], ["read:all", "read:sensitive", "read:field", "read:interface", "read:private"], ["read:all", "read:sensitive", "read:field"], ["read:all", "read:private", "read:field", "read:interface"], ["read:all", "read:private", "read:field"]])
          scalar: Scalar! @requiresScopes(scopes: [["read:scalar", "read:interface", "read:private"], ["read:scalar", "read:all"]])
          scalarTwo: Scalar! @authenticated @requiresScopes(scopes: [["read:object", "read:scalars", "read:sensitive", "read:field"], ["read:object", "read:scalars", "read:private", "read:field"], ["read:all", "read:scalars", "read:sensitive", "read:field"], ["read:all", "read:scalars", "read:private", "read:field"]])
        }
        
        interface Interface {
          age: Int! @authenticated @requiresScopes(scopes: [["read:sensitive", "read:field"], ["read:private", "read:field"]])
          id: ID! @authenticated @requiresScopes(scopes: [["read:sensitive", "read:field", "read:interface", "read:private"], ["read:sensitive", "read:field", "read:all"], ["read:private", "read:field", "read:interface"], ["read:private", "read:field", "read:all"]])
          scalar: Scalar! @requiresScopes(scopes: [["read:interface", "read:private", "read:scalar"], ["read:all", "read:scalar"]])
          scalarTwo: Scalar! @authenticated @requiresScopes(scopes: [["read:sensitive", "read:field", "read:scalars"], ["read:private", "read:field", "read:scalars"]])
        }
        
        type Query {
          entity: Entity!
          scalar: Scalar! @requiresScopes(scopes: [["read:scalar"]])
        }

        scalar Scalar
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly for extensions #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphJ]);
      expect(errors).toBeUndefined();
      expect(federationResult!.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [['read:subgraph-i']],
        },
        {
          argumentNames: [],
          fieldName: 'name',
          typeName: 'Entity',
          requiresAuthentication: false,
          requiredScopes: [['read:subgraph-i']],
        },
        {
          argumentNames: [],
          fieldName: 'age',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:private', 'read:object', 'read:scalar'],
            ['read:private', 'read:object', 'read:subgraph-j'],
            ['read:field', 'read:object', 'read:scalar'],
            ['read:field', 'read:object', 'read:subgraph-j'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'isEntity',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [['read:subgraph-j']],
        },
      ]);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
          type Entity {
            age: Int! @authenticated
            id: ID! @requiresScopes(scopes: [["read:subgraph-i"]]) @authenticated
            isEntity: Boolean! @authenticated @requiresScopes(scopes: [["read:subgraph-j"]])
            name: String! @requiresScopes(scopes: [["read:subgraph-i"]])
            scalar: Scalar! @authenticated @requiresScopes(scopes: [["read:private", "read:object", "read:scalar"], ["read:private", "read:object", "read:subgraph-j"], ["read:field", "read:object", "read:scalar"], ["read:field", "read:object", "read:subgraph-j"]])
          }
          
          type Query {
            entity: Entity!
          }
          
          scalar Scalar
          
          scalar openfed__Scope
      `,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly for extensions #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphJ, subgraphI]);
      expect(errors).toBeUndefined();
      expect(federationResult!.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:private', 'read:object', 'read:scalar'],
            ['read:private', 'read:object', 'read:subgraph-j'],
            ['read:field', 'read:object', 'read:scalar'],
            ['read:field', 'read:object', 'read:subgraph-j'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'isEntity',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [['read:subgraph-j']],
        },
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [['read:subgraph-i']],
        },
        {
          argumentNames: [],
          fieldName: 'name',
          typeName: 'Entity',
          requiresAuthentication: false,
          requiredScopes: [['read:subgraph-i']],
        },
        {
          argumentNames: [],
          fieldName: 'age',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [],
        },
      ]);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
        type Entity {
          age: Int! @authenticated
          id: ID! @authenticated @requiresScopes(scopes: [["read:subgraph-i"]])
          isEntity: Boolean! @authenticated @requiresScopes(scopes: [["read:subgraph-j"]])
          name: String! @requiresScopes(scopes: [["read:subgraph-i"]])
          scalar: Scalar! @authenticated @requiresScopes(scopes: [["read:private", "read:object", "read:scalar"], ["read:private", "read:object", "read:subgraph-j"], ["read:field", "read:object", "read:scalar"], ["read:field", "read:object", "read:subgraph-j"]])
        }
        
        type Query {
          entity: Entity!
        }
        
        scalar Scalar
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly with interface objects #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphM, subgraphN]);
      expect(errors).toBeUndefined();
      expect(federationResult!.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'EntityThree',
          requiresAuthentication: true,
          requiredScopes: [['read:interface', 'read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'isEntity',
          typeName: 'EntityThree',
          requiresAuthentication: false,
          requiredScopes: [['read:entity']],
        },
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'EntityThree',
          requiresAuthentication: true,
          requiredScopes: [['read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'EntityThree',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:private', 'read:scalar'],
            ['read:private', 'read:field'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'Interface',
          requiresAuthentication: false,
          requiredScopes: [['read:interface', 'read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'Interface',
          requiresAuthentication: true,
          requiredScopes: [['read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Interface',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:private', 'read:scalar'],
            ['read:private', 'read:field'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'EntityOne',
          requiresAuthentication: false,
          requiredScopes: [['read:entity', 'read:interface', 'read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'name',
          typeName: 'EntityOne',
          requiresAuthentication: false,
          requiredScopes: [['read:entity']],
        },
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'EntityOne',
          requiresAuthentication: true,
          requiredScopes: [['read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'EntityOne',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:private', 'read:scalar'],
            ['read:private', 'read:field'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'EntityTwo',
          requiresAuthentication: true,
          requiredScopes: [['read:interface', 'read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'age',
          typeName: 'EntityTwo',
          requiresAuthentication: true,
          requiredScopes: [],
        },
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'EntityTwo',
          requiresAuthentication: true,
          requiredScopes: [['read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'EntityTwo',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:private', 'read:scalar'],
            ['read:private', 'read:field'],
          ],
        },
      ]);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
        type EntityOne implements Interface {
          id: ID! @requiresScopes(scopes: [["read:entity", "read:interface", "read:private"]])
          name: String! @requiresScopes(scopes: [["read:entity"]])
          newField: String! @authenticated @requiresScopes(scopes: [["read:private"]])
          scalar: Scalar! @authenticated @requiresScopes(scopes: [["read:private", "read:scalar"], ["read:private", "read:field"]])
        }
        
        type EntityThree implements Interface {
          id: ID! @authenticated @requiresScopes(scopes: [["read:interface", "read:private"]])
          isEntity: Boolean! @requiresScopes(scopes: [["read:entity"]])
          newField: String! @authenticated @requiresScopes(scopes: [["read:private"]])
          scalar: Scalar! @authenticated @requiresScopes(scopes: [["read:private", "read:scalar"], ["read:private", "read:field"]])
        }
        
        type EntityTwo implements Interface {
          age: Int! @authenticated
          id: ID! @authenticated @requiresScopes(scopes: [["read:interface", "read:private"]])
          newField: String! @authenticated @requiresScopes(scopes: [["read:private"]])
          scalar: Scalar! @authenticated @requiresScopes(scopes: [["read:private", "read:scalar"], ["read:private", "read:field"]])
        }
        
        
        interface Interface {
          id: ID! @requiresScopes(scopes: [["read:interface", "read:private"]])
          newField: String! @authenticated @requiresScopes(scopes: [["read:private"]])
          scalar: Scalar! @authenticated @requiresScopes(scopes: [["read:private", "read:scalar"], ["read:private", "read:field"]])
        }
        
        type Query {
          entities: [Interface!]!
        }
        
        scalar Scalar
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly with interface objects #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphN, subgraphM]);
      expect(errors).toBeUndefined();
      expect(federationResult!.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'Interface',
          requiresAuthentication: true,
          requiredScopes: [['read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'Interface',
          requiresAuthentication: false,
          requiredScopes: [['read:private', 'read:interface']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Interface',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:private', 'read:scalar'],
            ['read:private', 'read:field'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'EntityThree',
          requiresAuthentication: true,
          requiredScopes: [['read:interface', 'read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'isEntity',
          typeName: 'EntityThree',
          requiresAuthentication: false,
          requiredScopes: [['read:entity']],
        },
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'EntityThree',
          requiresAuthentication: true,
          requiredScopes: [['read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'EntityThree',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:private', 'read:scalar'],
            ['read:private', 'read:field'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'EntityOne',
          requiresAuthentication: false,
          requiredScopes: [['read:entity', 'read:interface', 'read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'name',
          typeName: 'EntityOne',
          requiresAuthentication: false,
          requiredScopes: [['read:entity']],
        },
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'EntityOne',
          requiresAuthentication: true,
          requiredScopes: [['read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'EntityOne',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:private', 'read:scalar'],
            ['read:private', 'read:field'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'EntityTwo',
          requiresAuthentication: true,
          requiredScopes: [['read:interface', 'read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'age',
          typeName: 'EntityTwo',
          requiresAuthentication: true,
          requiredScopes: [],
        },
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'EntityTwo',
          requiresAuthentication: true,
          requiredScopes: [['read:private']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'EntityTwo',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:private', 'read:scalar'],
            ['read:private', 'read:field'],
          ],
        },
      ]);
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
        type EntityOne implements Interface {
          id: ID! @requiresScopes(scopes: [["read:entity", "read:interface", "read:private"]])
          name: String! @requiresScopes(scopes: [["read:entity"]])
          newField: String! @authenticated @requiresScopes(scopes: [["read:private"]])
          scalar: Scalar! @authenticated @requiresScopes(scopes: [["read:private", "read:scalar"], ["read:private", "read:field"]])
        }
        
        type EntityThree implements Interface {
          id: ID! @authenticated @requiresScopes(scopes: [["read:interface", "read:private"]])
          isEntity: Boolean! @requiresScopes(scopes: [["read:entity"]])
          newField: String! @authenticated @requiresScopes(scopes: [["read:private"]])
          scalar: Scalar! @authenticated @requiresScopes(scopes: [["read:private", "read:scalar"], ["read:private", "read:field"]])
        }
        
        type EntityTwo implements Interface {
          age: Int! @authenticated
          id: ID! @authenticated @requiresScopes(scopes: [["read:interface", "read:private"]])
          newField: String! @authenticated @requiresScopes(scopes: [["read:private"]])
          scalar: Scalar! @authenticated @requiresScopes(scopes: [["read:private", "read:scalar"], ["read:private", "read:field"]])
        }
        
        
        interface Interface {
          id: ID! @requiresScopes(scopes: [["read:private", "read:interface"]])
          newField: String! @authenticated @requiresScopes(scopes: [["read:private"]])
          scalar: Scalar! @authenticated @requiresScopes(scopes: [["read:private", "read:scalar"], ["read:private", "read:field"]])
        }
        
        type Query {
          entities: [Interface!]!
        }
        
        scalar Scalar
        
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly with renamed root types', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphO, subgraphP]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoSchemaQueryAndPersistedDirectiveDefinitions +
            `
        enum Enum {
          VALUE
        }
        
        type Query {
          enum: Enum! @authenticated @requiresScopes(scopes: [["read:query", "read:enum"]])
          scalar: Scalar! @authenticated @requiresScopes(scopes: [["read:query", "read:scalar"], ["read:query", "read:field"]])
        }
        
        scalar Scalar
        
        scalar openfed__Scope
      `,
        ),
      );
      expect(federationResult!.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'enum',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [['read:query', 'read:enum']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [
            ['read:query', 'read:scalar'],
            ['read:query', 'read:field'],
          ],
        },
      ]);
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
      scalar: Scalar
    }
    
    type Entity @key(fields: "id") @authenticated @requiresScopes(scopes: [["read:object"]]) {
      id: ID!
      name: String!
    }
    
    scalar Scalar
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
      scalarTwo: Scalar
    }
    
    type Entity @key(fields: "id") {
      id: ID!
      age: Int!
    }
    
    scalar Scalar @authenticated
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
      scalar: Scalar!
    }
    
    interface Interface @requiresScopes(scopes: [["read:interface", "read:private"], ["read:all"]]) {
      id: ID!
      scalar: Scalar!
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      scalar: Scalar!
    }
    
    scalar Scalar @requiresScopes(scopes: [["read:scalar"]])
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    interface Interface @requiresScopes(scopes: [["read:sensitive", "read:field"], ["read:private", "read:field"]]) @authenticated {
      id: ID!
      age: Int!
      scalarTwo: Scalar!
    }

    type Entity implements Interface @key(fields: "id") @requiresScopes(scopes: [["read:object"], ["read:all"]]) {
      id: ID!
      age: Int!
      scalarTwo: Scalar!
    }
    
    scalar Scalar @requiresScopes(scopes: [["read:scalars"]])
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    type Entity @key(fields: "id") @requiresScopes(scopes: [["read:subgraph-i"]]) {
      id: ID!
      name: String!
    }
    
    extend type Entity @authenticated {
      age: Int!
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    extend type Entity @requiresScopes(scopes: [["read:object"]]) {
      scalar: Scalar! @requiresScopes(scopes: [["read:private"], ["read:field"]])
    }
    
    type Entity @key(fields: "id") @authenticated {
      id: ID!
      isEntity: Boolean! @requiresScopes(scopes: [["read:subgraph-j"]])
    }
    
    scalar Scalar
    
    extend scalar Scalar @authenticated
    
    extend scalar Scalar @requiresScopes(scopes: [["read:scalar"], ["read:subgraph-j"]])
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity! @shareable @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"]])
    }
    
    interface Interface @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"]]) {
      id: ID! 
    }
    
    type Entity implements Interface @key(fields: "id")  {
      id: ID! @requiresScopes(scopes: [["a"], ["b"]])
      enum: Enum! @shareable
    }
    
    enum Enum @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"]]) {
      VALUE
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    type Query @requiresScopes(scopes: [["f"], ["g"], ["h"], ["i"], ["j"]]) {
      entity: Entity! @shareable
    }

    interface Interface {
      enum: Enum! @requiresScopes(scopes: [["f"], ["g"], ["h"], ["i"], ["j"]])
    }
    
    type Entity implements Interface @key(fields: "id")  @requiresScopes(scopes: [["f"], ["g"], ["h"], ["i"], ["j"]]) {
      id: ID!
      enum: Enum! @shareable
    }
    
    enum Enum {
      VALUE
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Interface!]!
    }
    
    interface Interface @key(fields: "id") @requiresScopes(scopes: [["read:interface"]]) {
      id: ID!
    }
    
    type EntityOne implements Interface @key(fields: "id") @requiresScopes(scopes: [["read:entity"]]) {
      id: ID!
      name: String!
    }
    
    type EntityTwo implements Interface @key(fields: "id") @authenticated {
      id: ID!
      age: Int!
    }
    
    type EntityThree implements Interface @key(fields: "id") {
      id: ID! @authenticated
      isEntity: Boolean! @requiresScopes(scopes: [["read:entity"]])
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    type Interface @key(fields: "id") @interfaceObject @requiresScopes(scopes: [["read:private"]]) {
      id: ID!
      newField: String! @authenticated
      scalar: Scalar!
    }
    
    scalar Scalar @authenticated @requiresScopes(scopes: [["read:scalar"], ["read:field"]])
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
     schema {
      query: Queries
    }
    
    type Queries @shareable @requiresScopes(scopes: [["read:query"]]) {
      enum: Enum!
      scalar: Scalar!
    }
    
    enum Enum {
      VALUE
    }
    
    scalar Scalar @requiresScopes(scopes: [["read:scalar"], ["read:field"]])
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    schema {
      query: MyQuery
    }
    
    type MyQuery @shareable {
      enum: Enum! @authenticated
      scalar: Scalar!
    }
    
    enum Enum @requiresScopes(scopes: [["read:enum"]]) {
      VALUE
    }
    
    scalar Scalar @authenticated
  `),
};
