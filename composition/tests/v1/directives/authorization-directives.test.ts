import { describe, expect, test } from 'vitest';
import {
  AuthorizationData,
  FieldAuthorizationData,
  INTERFACE,
  MAX_OR_SCOPES,
  OBJECT,
  orScopesLimitError,
  parse,
  QUERY,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '../../../src';
import {
  AUTHENTICATED_DIRECTIVE,
  OPENFED_SCOPE,
  REQUIRES_SCOPES_DIRECTIVE,
  SCHEMA_QUERY_DEFINITION,
} from '../utils/utils';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';

describe('Authorization directives tests', () => {
  describe('Normalization Tests', () => {
    test('that authentication is merged correctly #1', () => {
      const result = normalizeSubgraphSuccess(na, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.authorizationDataByParentTypeName).toStrictEqual(
        new Map<string, AuthorizationData>([
          [
            'Query',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>([
                [
                  'object',
                  {
                    fieldName: 'object',
                    inheritedData: {
                      requiredScopes: [],
                      requiredScopesByOR: [],
                      requiresAuthentication: true,
                    },
                    originalData: {
                      requiredScopes: [],
                      requiresAuthentication: true,
                    },
                  },
                ],
              ]),
              requiredScopes: [],
              requiredScopesByOR: [],
              requiresAuthentication: false,
              typeName: 'Query',
            },
          ],
        ]),
      );
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            AUTHENTICATED_DIRECTIVE +
            `
          type Object {
            b: Boolean!
          }
          
          type Query {
            object: Object! @authenticated
          }
        `,
        ),
      );
    });

    test('that authentication is merged correctly #2', () => {
      const result = normalizeSubgraphSuccess(nb, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.authorizationDataByParentTypeName).toStrictEqual(
        new Map<string, AuthorizationData>([
          [
            'Object',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>(),
              requiredScopesByOR: [],
              requiresAuthentication: true,
              requiredScopes: [],
              typeName: 'Object',
            },
          ],
        ]),
      );
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            AUTHENTICATED_DIRECTIVE +
            `
          type Object @authenticated {
            b: Boolean!
          }
          
          type Query {
            object: Object!
          }
        `,
        ),
      );
    });

    test('that required scopes are merged correctly #1', () => {
      const result = normalizeSubgraphSuccess(nc, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.authorizationDataByParentTypeName).toStrictEqual(
        new Map<string, AuthorizationData>([
          [
            'Query',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>([
                [
                  'object',
                  {
                    fieldName: 'object',
                    inheritedData: {
                      requiredScopes: [new Set<string>(['a']), new Set<string>(['b'])],
                      requiredScopesByOR: [],
                      requiresAuthentication: false,
                    },
                    originalData: {
                      requiredScopes: [new Set<string>(['a']), new Set<string>(['b'])],
                      requiresAuthentication: false,
                    },
                  },
                ],
              ]),
              requiredScopesByOR: [],
              requiresAuthentication: false,
              requiredScopes: [],
              typeName: 'Query',
            },
          ],
          [
            'Object',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>(),
              requiredScopesByOR: [],
              requiresAuthentication: false,
              requiredScopes: [new Set<string>(['a', 'b']), new Set<string>(['c'])],
              typeName: 'Object',
            },
          ],
        ]),
      );
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            REQUIRES_SCOPES_DIRECTIVE +
            `
          type Object @requiresScopes(scopes: [["a", "b"], ["c"]]) {
            b: Boolean!
          }
          
          type Query {
            object: Object @requiresScopes(scopes: [["a"], ["b"]])
          }
        ` +
            OPENFED_SCOPE,
        ),
      );
    });

    test('that required scopes are merged correctly #2', () => {
      const result = normalizeSubgraphSuccess(nd, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.authorizationDataByParentTypeName).toStrictEqual(
        new Map<string, AuthorizationData>([
          [
            'Query',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>([
                [
                  'object',
                  {
                    fieldName: 'object',
                    inheritedData: {
                      requiredScopes: [new Set<string>(['a', 'b'])],
                      requiredScopesByOR: [],
                      requiresAuthentication: false,
                    },
                    originalData: {
                      requiredScopes: [new Set<string>(['a', 'b'])],
                      requiresAuthentication: false,
                    },
                  },
                ],
              ]),
              requiredScopesByOR: [],
              requiresAuthentication: false,
              requiredScopes: [],
              typeName: 'Query',
            },
          ],
          [
            'Object',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>(),
              requiredScopesByOR: [],
              requiresAuthentication: false,
              requiredScopes: [new Set<string>(['a']), new Set<string>(['b']), new Set<string>(['c'])],
              typeName: 'Object',
            },
          ],
        ]),
      );
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            REQUIRES_SCOPES_DIRECTIVE +
            `
          type Object @requiresScopes(scopes: [["a"], ["b"], ["c"]]) {
            b: Boolean!
          }
          
          type Query {
            object: Object @requiresScopes(scopes: [["a", "b"]])
          }
        ` +
            OPENFED_SCOPE,
        ),
      );
    });

    test('that authentication and required scopes are merged correctly', () => {
      const result = normalizeSubgraphSuccess(ne, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.authorizationDataByParentTypeName).toStrictEqual(
        new Map<string, AuthorizationData>([
          [
            'Object',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>([
                [
                  'b',
                  {
                    fieldName: 'b',
                    inheritedData: {
                      requiredScopes: [new Set<string>(['f']), new Set<string>(['c'])],
                      requiredScopesByOR: [],
                      requiresAuthentication: true,
                    },
                    originalData: {
                      requiredScopes: [new Set<string>(['f']), new Set<string>(['c'])],
                      requiresAuthentication: true,
                    },
                  },
                ],
              ]),
              requiredScopesByOR: [],
              requiresAuthentication: true,
              requiredScopes: [new Set<string>(['b', 'c']), new Set<string>(['d'])],
              typeName: 'Object',
            },
          ],
          [
            'Query',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>([
                [
                  'object',
                  {
                    fieldName: 'object',
                    inheritedData: {
                      requiredScopes: [new Set<string>(['a']), new Set<string>(['b'])],
                      requiredScopesByOR: [],
                      requiresAuthentication: true,
                    },
                    originalData: {
                      requiredScopes: [new Set<string>(['a']), new Set<string>(['b'])],
                      requiresAuthentication: true,
                    },
                  },
                ],
              ]),
              requiredScopesByOR: [],
              requiresAuthentication: false,
              requiredScopes: [],
              typeName: 'Query',
            },
          ],
          [
            'Scalar',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>(),
              requiredScopesByOR: [],
              requiresAuthentication: true,
              requiredScopes: [new Set<string>(['c', 'e']), new Set<string>(['d'])],
              typeName: 'Scalar',
            },
          ],
        ]),
      );
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            AUTHENTICATED_DIRECTIVE +
            REQUIRES_SCOPES_DIRECTIVE +
            `
          type Object @authenticated @requiresScopes(scopes: [["b", "c"], ["d"]]) {
            b: Boolean! @authenticated @requiresScopes(scopes: [["f"], ["c"]])
            s: Scalar!
          }
          
          type Query {
            object: Object @authenticated @requiresScopes(scopes: [["a"], ["b"]])
          }
          
          scalar Scalar @authenticated @requiresScopes(scopes: [["c", "e"], ["d"]])
        ` +
            OPENFED_SCOPE,
        ),
      );
    });

    test('that an error is returned if the limit of @requiresScopes scopes is exceeded #1', () => {
      const result = normalizeSubgraphFailure(nf, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(
        orScopesLimitError(MAX_OR_SCOPES, ['Query', 'Interface', 'Enum', 'Scalar']),
      );
    });

    test('that merged scopes remove any superfluous scopes #1', () => {
      const result = normalizeSubgraphSuccess(nh, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.authorizationDataByParentTypeName).toStrictEqual(
        new Map<string, AuthorizationData>([
          [
            'Query',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>([
                [
                  'scalar',
                  {
                    fieldName: 'scalar',
                    inheritedData: {
                      requiredScopes: [new Set<string>(['a']), new Set<string>(['b']), new Set<string>(['c'])],
                      requiredScopesByOR: [],
                      requiresAuthentication: false,
                    },
                    originalData: {
                      requiredScopes: [new Set<string>(['a']), new Set<string>(['b']), new Set<string>(['c'])],
                      requiresAuthentication: false,
                    },
                  },
                ],
              ]),
              requiredScopesByOR: [],
              requiresAuthentication: false,
              requiredScopes: [],
              typeName: 'Query',
            },
          ],
          [
            'Scalar',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>(),
              requiredScopesByOR: [],
              requiresAuthentication: false,
              requiredScopes: [new Set<string>(['a']), new Set<string>(['b']), new Set<string>(['c'])],
              typeName: 'Scalar',
            },
          ],
        ]),
      );
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            REQUIRES_SCOPES_DIRECTIVE +
            `
          type Query {
            scalar: Scalar! @requiresScopes(scopes: [["a"], ["b"], ["c"]])
          }
          
          scalar Scalar @requiresScopes(scopes: [["a"], ["b"], ["c"]])
        ` +
            OPENFED_SCOPE,
        ),
      );
    });

    test('that merged scopes remove any superfluous scopes #2', () => {
      const result = normalizeSubgraphSuccess(ni, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.authorizationDataByParentTypeName).toStrictEqual(
        new Map<string, AuthorizationData>([
          [
            'Query',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>([
                [
                  'scalar',
                  {
                    fieldName: 'scalar',
                    inheritedData: {
                      requiredScopes: [new Set<string>(['a']), new Set<string>(['b']), new Set<string>(['c'])],
                      requiredScopesByOR: [],
                      requiresAuthentication: false,
                    },
                    originalData: {
                      requiredScopes: [new Set<string>(['a']), new Set<string>(['b']), new Set<string>(['c'])],
                      requiresAuthentication: false,
                    },
                  },
                ],
              ]),
              requiredScopesByOR: [],
              requiresAuthentication: false,
              requiredScopes: [],
              typeName: 'Query',
            },
          ],
          [
            'Scalar',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>(),
              requiredScopes: [
                new Set<string>(['a']),
                new Set<string>(['b']),
                new Set<string>(['c']),
                new Set<string>(['d']),
              ],
              requiredScopesByOR: [],
              requiresAuthentication: false,
              typeName: 'Scalar',
            },
          ],
        ]),
      );
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            REQUIRES_SCOPES_DIRECTIVE +
            `
          type Query {
            scalar: Scalar! @requiresScopes(scopes: [["a"], ["b"], ["c"]])
          }
          
          scalar Scalar @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"]])
          ` +
            OPENFED_SCOPE,
        ),
      );
    });

    test('that merged scopes remove any superfluous scopes #3', () => {
      const result = normalizeSubgraphSuccess(nj, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.authorizationDataByParentTypeName).toStrictEqual(
        new Map<string, AuthorizationData>([
          [
            'Query',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>([
                [
                  'scalar',
                  {
                    fieldName: 'scalar',
                    inheritedData: {
                      requiresAuthentication: false,
                      requiredScopes: [new Set<string>(['a', 'b', 'c'])],
                      requiredScopesByOR: [],
                    },
                    originalData: {
                      requiresAuthentication: false,
                      requiredScopes: [new Set<string>(['a', 'b', 'c'])],
                    },
                  },
                ],
              ]),
              requiredScopesByOR: [],
              requiresAuthentication: false,
              requiredScopes: [],
              typeName: 'Query',
            },
          ],
          [
            'Scalar',
            {
              fieldAuthDataByFieldName: new Map<string, FieldAuthorizationData>(),
              requiredScopesByOR: [],
              requiresAuthentication: false,
              requiredScopes: [new Set<string>(['a'])],
              typeName: 'Scalar',
            },
          ],
        ]),
      );
      expect(schemaToSortedNormalizedString(result.schema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            REQUIRES_SCOPES_DIRECTIVE +
            `
          type Query {
            scalar: Scalar! @requiresScopes(scopes: [["a", "b", "c"]])
          }
          
          scalar Scalar @requiresScopes(scopes: [["a", "b"], ["a"]])
        ` +
            OPENFED_SCOPE,
        ),
      );
    });
  });

  describe('Federation tests', () => {
    describe('@authenticated tests', () => {
      test('that @authenticated is persisted in the federated schema', () => {
        const { fieldConfigurations, federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
          [faa, fab],
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(fieldConfigurations).toStrictEqual([
          {
            argumentNames: [],
            fieldName: 'object',
            typeName: QUERY,
            requiresAuthentication: true,
            requiredScopes: [],
            requiredScopesByOR: [],
          },
        ]);
        expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
          normalizeString(
            SCHEMA_QUERY_DEFINITION +
              AUTHENTICATED_DIRECTIVE +
              `
          type Object @authenticated {
            age: Int!
            id: ID!
            name: String!
          }
          
          type Query {
            object: Object!
          }
        `,
          ),
        );
        expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
          normalizeString(
            SCHEMA_QUERY_DEFINITION +
              `
          type Object {
            age: Int!
            id: ID!
            name: String!
          }
          
          type Query {
            object: Object!
          }
        `,
          ),
        );
      });

      test('that @authenticated on an Enum type generates the correct router configuration', () => {
        const { fieldConfigurations, federatedGraphSchema } = federateSubgraphsSuccess(
          [fiaa, fiab],
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(fieldConfigurations).toStrictEqual([
          {
            argumentNames: [],
            fieldName: 'a',
            requiredScopes: [],
            requiredScopesByOR: [],
            requiresAuthentication: true,
            typeName: QUERY,
          },
          {
            argumentNames: [],
            fieldName: 'b',
            requiredScopes: [],
            requiredScopesByOR: [],
            requiresAuthentication: true,
            typeName: QUERY,
          },
          {
            argumentNames: [],
            fieldName: 'c',
            requiredScopes: [],
            requiredScopesByOR: [],
            requiresAuthentication: true,
            typeName: QUERY,
          },
        ]);
        expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
          normalizeString(
            SCHEMA_QUERY_DEFINITION +
              AUTHENTICATED_DIRECTIVE +
              `
            enum Enum @authenticated {
              A
            }
            
            type Query {
              a: Enum!
              b: Enum!
              c: Enum!
            }
          `,
          ),
        );
      });

      test('that @authenticated on an Interface type generates the correct router configuration', () => {
        const { fieldConfigurations, federatedGraphSchema } = federateSubgraphsSuccess(
          [fjaa, fjab],
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(fieldConfigurations).toStrictEqual([
          {
            argumentNames: [],
            fieldName: 'a',
            requiredScopes: [],
            requiredScopesByOR: [],
            requiresAuthentication: true,
            typeName: QUERY,
          },
          {
            argumentNames: [],
            fieldName: 'b',
            requiredScopes: [],
            requiredScopesByOR: [],
            requiresAuthentication: true,
            typeName: QUERY,
          },
          {
            argumentNames: [],
            fieldName: 'd',
            requiredScopes: [],
            requiredScopesByOR: [],
            requiresAuthentication: true,
            typeName: QUERY,
          },
        ]);
        expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
          normalizeString(
            SCHEMA_QUERY_DEFINITION +
              AUTHENTICATED_DIRECTIVE +
              `
            interface Interface @authenticated {
              a: ID
            }
            
            type Object implements Interface {
              a: ID
            }
            
            type Query {
              a: Interface!
              b: Interface!
              c: Object!
              d: Interface!
              e: Object!
            }
          `,
          ),
        );
      });

      test('that @authenticated on an Object type generates the correct router configuration', () => {
        const { fieldConfigurations, federatedGraphSchema } = federateSubgraphsSuccess(
          [fkaa, fkab],
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(fieldConfigurations).toStrictEqual([
          {
            argumentNames: [],
            fieldName: 'a',
            requiredScopes: [],
            requiredScopesByOR: [],
            requiresAuthentication: true,
            typeName: QUERY,
          },
          {
            argumentNames: [],
            fieldName: 'b',
            requiredScopes: [],
            requiredScopesByOR: [],
            requiresAuthentication: true,
            typeName: QUERY,
          },
          {
            argumentNames: [],
            fieldName: 'c',
            requiredScopes: [],
            requiredScopesByOR: [],
            requiresAuthentication: true,
            typeName: QUERY,
          },
        ]);
        expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
          normalizeString(
            SCHEMA_QUERY_DEFINITION +
              AUTHENTICATED_DIRECTIVE +
              `
            type Object @authenticated {
              a: ID
            }
            
            type Query {
              a: Object!
              b: Object!
              c: Object!
            }
          `,
          ),
        );
      });

      test('that @authenticated on a Scalar type generates the correct router configuration', () => {
        const { fieldConfigurations, federatedGraphSchema } = federateSubgraphsSuccess(
          [flaa, flab],
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(fieldConfigurations).toStrictEqual([
          {
            argumentNames: [],
            fieldName: 'a',
            requiredScopes: [],
            requiredScopesByOR: [],
            requiresAuthentication: true,
            typeName: QUERY,
          },
          {
            argumentNames: [],
            fieldName: 'b',
            requiredScopes: [],
            requiredScopesByOR: [],
            requiresAuthentication: true,
            typeName: QUERY,
          },
          {
            argumentNames: [],
            fieldName: 'c',
            requiredScopes: [],
            requiredScopesByOR: [],
            requiresAuthentication: true,
            typeName: QUERY,
          },
        ]);
        expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
          normalizeString(
            SCHEMA_QUERY_DEFINITION +
              AUTHENTICATED_DIRECTIVE +
              `
            type Query {
              a: Scalar!
              b: Scalar!
              c: Scalar!
            }
            
            scalar Scalar @authenticated
          `,
          ),
        );
      });

      test('that @authenticated on an Interface field generates the correct router configuration', () => {
        const { fieldConfigurations, federatedGraphSchema } = federateSubgraphsSuccess(
          [fmaa, fmab],
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(fieldConfigurations).toStrictEqual([
          {
            argumentNames: [],
            fieldName: 'a',
            requiredScopes: [],
            requiredScopesByOR: [],
            requiresAuthentication: true,
            typeName: INTERFACE,
          },
        ]);
        expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
          normalizeString(
            SCHEMA_QUERY_DEFINITION +
              AUTHENTICATED_DIRECTIVE +
              `
            interface Interface {
              a: ID @authenticated
            }
            
            type Object implements Interface {
              a: ID
            }
            
            type Query {
              a: Interface!
              b: Interface!
              c: Object!
              d: Interface!
              e: Object!
            }
          `,
          ),
        );
      });

      test('that @authenticated on an Object field generates the correct router configuration', () => {
        const { fieldConfigurations, federatedGraphSchema } = federateSubgraphsSuccess(
          [fnaa, fnab],
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(fieldConfigurations).toStrictEqual([
          {
            argumentNames: [],
            fieldName: 'a',
            requiredScopes: [],
            requiredScopesByOR: [],
            requiresAuthentication: true,
            typeName: OBJECT,
          },
        ]);
        expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
          normalizeString(
            SCHEMA_QUERY_DEFINITION +
              AUTHENTICATED_DIRECTIVE +
              `            
            type Object {
              a: ID @authenticated
            }
            
            type Query {
              a: Object!
              b: Object!
              c: Object!
            }
          `,
          ),
        );
      });
    });

    describe('@requiresScopes tests', () => {
      test('that @requiresScopes is persisted in the federated schema', () => {
        const { fieldConfigurations, federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
          [fab, fac],
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(fieldConfigurations).toStrictEqual([
          {
            argumentNames: [],
            fieldName: 'object',
            typeName: QUERY,
            requiresAuthentication: false,
            requiredScopes: [['b']],
            requiredScopesByOR: [['b']],
          },
        ]);
        expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
          normalizeString(
            SCHEMA_QUERY_DEFINITION +
              REQUIRES_SCOPES_DIRECTIVE +
              `
          type Object @requiresScopes(scopes: [["b"]]) {
            age: Int!
            id: ID!
            name: String!
          }
          
          type Query {
            object: Object!
          }
        ` +
              OPENFED_SCOPE,
          ),
        );
        expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
          normalizeString(
            SCHEMA_QUERY_DEFINITION +
              `
          type Object {
            age: Int!
            id: ID!
            name: String!
          }
          
          type Query {
            object: Object!
          }
        `,
          ),
        );
      });

      test('that @requiresScopes defined on an Interface field does not affect its implementations', () => {
        const { fieldConfigurations, federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
          [foaa],
          ROUTER_COMPATIBILITY_VERSION_ONE,
        );
        expect(fieldConfigurations).toStrictEqual([
          {
            argumentNames: [],
            fieldName: 'id',
            typeName: INTERFACE,
            requiresAuthentication: false,
            requiredScopes: [['read:id']],
            requiredScopesByOR: [['read:id']],
          },
        ]);
        expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
          normalizeString(
            SCHEMA_QUERY_DEFINITION +
              REQUIRES_SCOPES_DIRECTIVE +
              `
            interface Interface {
              id: ID! @requiresScopes(scopes: [["read:id"]])
              name: String!
            }
            
            type Object implements Interface {
              id: ID!
              name: String!
            }
            
            type Query {
              interfaces: [Interface!]!
              objects: [Object!]!
            }
        ` +
              OPENFED_SCOPE,
          ),
        );
        expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
          normalizeString(
            SCHEMA_QUERY_DEFINITION +
              `
            interface Interface {
              id: ID!
              name: String!
            }
            
            type Object implements Interface {
              id: ID!
              name: String!
            }
            
            type Query {
              interfaces: [Interface!]!
              objects: [Object!]!
            }
        `,
          ),
        );
      });

      test('that an error is returned if the limit of @requiresScopes scopes is exceeded after federation #1.1', () => {
        const result = federateSubgraphsFailure([fba, fbb], ROUTER_COMPATIBILITY_VERSION_ONE);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toStrictEqual(orScopesLimitError(MAX_OR_SCOPES, ['Query.entity', 'Interface.enum']));
      });

      test('that an error is returned if the limit of @requiresScopes scopes is exceeded after federation #1.2', () => {
        const result = federateSubgraphsFailure([fbb, fba], ROUTER_COMPATIBILITY_VERSION_ONE);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toStrictEqual(orScopesLimitError(MAX_OR_SCOPES, ['Query.entity', 'Interface.enum']));
      });

      test('that inter-subgraph scopes reduce correctly #1', () => {
        const result = federateSubgraphsSuccess([fqab, fqaa], ROUTER_COMPATIBILITY_VERSION_ONE);
        expect(result.fieldConfigurations).toStrictEqual([
          {
            argumentNames: [],
            fieldName: 'ids',
            typeName: QUERY,
            requiresAuthentication: false,
            requiredScopes: [['a'], ['b']],
            requiredScopesByOR: [['a'], ['b']],
          },
        ]);
        expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
          normalizeString(
            SCHEMA_QUERY_DEFINITION +
              REQUIRES_SCOPES_DIRECTIVE +
              `
          type Query {
            ids: [ID!]! @requiresScopes(scopes: [["a"], ["b"]])
          }
        ` +
              OPENFED_SCOPE,
          ),
        );
      });

      test('that inter-subgraph scopes reduce correctly #2', () => {
        const result = federateSubgraphsSuccess([fqac, fqaa], ROUTER_COMPATIBILITY_VERSION_ONE);
        expect(result.fieldConfigurations).toStrictEqual([
          {
            argumentNames: [],
            fieldName: 'ids',
            typeName: QUERY,
            requiresAuthentication: false,
            requiredScopes: [['a'], ['b']],
            requiredScopesByOR: [['a'], ['b'], ['c']],
          },
        ]);
        expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
          normalizeString(
            SCHEMA_QUERY_DEFINITION +
              REQUIRES_SCOPES_DIRECTIVE +
              `
          type Query {
            ids: [ID!]! @requiresScopes(scopes: [["a"], ["b"]])
          }
        ` +
              OPENFED_SCOPE,
          ),
        );
      });
    });

    test('that authorization directives generate the correct router configuration', () => {
      const result = federateSubgraphsSuccess([fab, fad], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'name',
          typeName: 'Object',
          requiresAuthentication: true,
          requiredScopes: [],
          requiredScopesByOR: [],
        },
        {
          argumentNames: [],
          fieldName: 'object',
          typeName: 'Query',
          requiresAuthentication: false,
          requiredScopes: [['b']],
          requiredScopesByOR: [['b']],
        },
      ]);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            AUTHENTICATED_DIRECTIVE +
            REQUIRES_SCOPES_DIRECTIVE +
            `
          type Object @requiresScopes(scopes: [["b"]]) {
            age: Int!
            id: ID!
            name: String! @authenticated
          }
          
          type Query {
            object: Object!
          }
        ` +
            OPENFED_SCOPE,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly', () => {
      const result = federateSubgraphsSuccess([fca, fcb], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'entities',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [['b']],
          requiredScopesByOR: [['b']],
        },
        {
          argumentNames: [],
          fieldName: 'entity',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [['b']],
          requiredScopesByOR: [['b']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [],
          requiredScopesByOR: [],
        },
        {
          argumentNames: [],
          fieldName: 'scalarTwo',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [],
          requiredScopesByOR: [],
        },
      ]);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            AUTHENTICATED_DIRECTIVE +
            REQUIRES_SCOPES_DIRECTIVE +
            `
        type Entity @authenticated @requiresScopes(scopes: [["b"]]) {
          age: Int!
          id: ID!
          name: String!
        }
        
        type Query {
          entities: [Entity!]!
          entity: Entity!
          scalar: Scalar
          scalarTwo: Scalar
        }

        scalar Scalar @authenticated
      ` +
            OPENFED_SCOPE,
        ),
      );
    });

    test('that an error is returned if the limit of @requiresScopes scopes is exceeded by named type auth data', () => {
      const result = federateSubgraphsFailure([fda], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toStrictEqual(orScopesLimitError(MAX_OR_SCOPES, ['Query.enum', 'Query.scalar']));
    });

    test('that the federated graph and its router configuration are generated correctly for interfaces #1.1', () => {
      const result = federateSubgraphsSuccess([fea, feb], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Interface',
          requiresAuthentication: false,
          requiredScopes: [['j', 'e']],
          requiredScopesByOR: [['e'], ['j']],
        },
        {
          argumentNames: [],
          fieldName: 'scalarTwo',
          typeName: 'Interface',
          requiresAuthentication: false,
          requiredScopes: [['j', 'e']],
          requiredScopesByOR: [['e'], ['j']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Entity',
          requiresAuthentication: false,
          requiredScopes: [['j', 'e']],
          requiredScopesByOR: [['e'], ['j']],
        },
        {
          argumentNames: [],
          fieldName: 'scalarTwo',
          typeName: 'Entity',
          requiresAuthentication: false,
          requiredScopes: [['j', 'e']],
          requiredScopesByOR: [['e'], ['j']],
        },
        {
          argumentNames: [],
          fieldName: 'interfaces',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [
            ['i', 'c', 'd'],
            ['h', 'c', 'g'],
            ['h', 'c', 'd'],
          ],
          requiredScopesByOR: [['g', 'h'], ['d'], ['i', 'c'], ['h', 'c']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Query',
          requiresAuthentication: false,
          requiredScopes: [['j', 'e']],
          requiredScopesByOR: [['e'], ['j']],
        },
        {
          argumentNames: [],
          fieldName: 'entity',
          typeName: 'Query',
          requiresAuthentication: false,
          requiredScopes: [['b'], ['d']],
          requiredScopesByOR: [['b'], ['d']],
        },
      ]);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            AUTHENTICATED_DIRECTIVE +
            REQUIRES_SCOPES_DIRECTIVE +
            `
        type Entity implements Interface @requiresScopes(scopes: [["b"], ["d"]]) {
          age: Int!
          id: ID!
          scalar: Scalar!
          scalarTwo: Scalar!
        }
        
        interface Interface @authenticated @requiresScopes(scopes: [["i", "c", "d"], ["h", "c", "g"], ["h", "c", "d"]]) {
          age: Int!
          id: ID!
          scalar: Scalar!
          scalarTwo: Scalar!
        }
        
        type Query {
          entity: Entity!
          interfaces: [Interface!]!
          scalar: Scalar!
        }

        scalar Scalar @requiresScopes(scopes: [["j", "e"]])
      ` +
            OPENFED_SCOPE,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly for interfaces #1.2', () => {
      const result = federateSubgraphsSuccess([feb, fea], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'scalarTwo',
          typeName: 'Interface',
          requiresAuthentication: false,
          requiredScopes: [['e', 'j']],
          requiredScopesByOR: [['j'], ['e']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Interface',
          requiresAuthentication: false,
          requiredScopes: [['e', 'j']],
          requiredScopesByOR: [['j'], ['e']],
        },
        {
          argumentNames: [],
          fieldName: 'scalarTwo',
          typeName: 'Entity',
          requiresAuthentication: false,
          requiredScopes: [['e', 'j']],
          requiredScopesByOR: [['j'], ['e']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Entity',
          requiresAuthentication: false,
          requiredScopes: [['e', 'j']],
          requiredScopesByOR: [['j'], ['e']],
        },
        {
          argumentNames: [],
          fieldName: 'interfaces',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [
            ['g', 'h', 'c'],
            ['d', 'i', 'c'],
            ['d', 'h', 'c'],
          ],
          requiredScopesByOR: [['i', 'c'], ['h', 'c'], ['g', 'h'], ['d']],
        },
        {
          argumentNames: [],
          fieldName: 'entity',
          typeName: 'Query',
          requiresAuthentication: false,
          requiredScopes: [['b'], ['d']],
          requiredScopesByOR: [['b'], ['d']],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Query',
          requiresAuthentication: false,
          requiredScopes: [['e', 'j']],
          requiredScopesByOR: [['j'], ['e']],
        },
      ]);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            AUTHENTICATED_DIRECTIVE +
            REQUIRES_SCOPES_DIRECTIVE +
            `
        type Entity implements Interface @requiresScopes(scopes: [["b"], ["d"]]) {
          age: Int!
          id: ID!
          scalar: Scalar!
          scalarTwo: Scalar!
        }
        
        interface Interface @authenticated @requiresScopes(scopes: [["g", "h", "c"], ["d", "i", "c"], ["d", "h", "c"]]) {
          age: Int!
          id: ID!
          scalar: Scalar!
          scalarTwo: Scalar!
        }
        
        type Query {
          entity: Entity!
          interfaces: [Interface!]!
          scalar: Scalar!
        }

        scalar Scalar @requiresScopes(scopes: [["e", "j"]])
      ` +
            OPENFED_SCOPE,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly for extensions #1.1', () => {
      const result = federateSubgraphsSuccess([ffa, ffb], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [
            ['f', 'c'],
            ['f', 'd'],
            ['e', 'c'],
            ['e', 'd'],
          ],
          requiredScopesByOR: [
            ['f', 'c'],
            ['f', 'd'],
            ['e', 'c'],
            ['e', 'd'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'isEntity',
          typeName: 'Entity',
          requiresAuthentication: false,
          requiredScopes: [['e']],
          requiredScopesByOR: [['e']],
        },
        {
          argumentNames: [],
          fieldName: 'entity',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [['b', 'a']],
          requiredScopesByOR: [['a'], ['b']],
        },
      ]);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            AUTHENTICATED_DIRECTIVE +
            REQUIRES_SCOPES_DIRECTIVE +
            `
          type Entity @authenticated @requiresScopes(scopes: [["b", "a"]]) {
            age: Int!
            id: ID!
            isEntity: Boolean! @requiresScopes(scopes: [["e"]])
            name: String!
            scalar: Scalar! @requiresScopes(scopes: [["c"], ["d"]])
          }
          
          type Query {
            entity: Entity!
          }
          
          scalar Scalar @authenticated @requiresScopes(scopes: [["f"], ["e"]])
      ` +
            OPENFED_SCOPE,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly for extensions #1.2', () => {
      const result = federateSubgraphsSuccess([ffb, ffa], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Entity',
          requiresAuthentication: true,
          requiredScopes: [
            ['f', 'c'],
            ['f', 'd'],
            ['e', 'c'],
            ['e', 'd'],
          ],
          requiredScopesByOR: [
            ['f', 'c'],
            ['f', 'd'],
            ['e', 'c'],
            ['e', 'd'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'isEntity',
          typeName: 'Entity',
          requiresAuthentication: false,
          requiredScopes: [['e']],
          requiredScopesByOR: [['e']],
        },
        {
          argumentNames: [],
          fieldName: 'entity',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [['a', 'b']],
          requiredScopesByOR: [['b'], ['a']],
        },
      ]);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            AUTHENTICATED_DIRECTIVE +
            REQUIRES_SCOPES_DIRECTIVE +
            `
          type Entity @authenticated @requiresScopes(scopes: [["a", "b"]]) {
            age: Int!
            id: ID!
            isEntity: Boolean! @requiresScopes(scopes: [["e"]])
            name: String!
            scalar: Scalar! @requiresScopes(scopes: [["c"], ["d"]])
          }
          
          type Query {
            entity: Entity!
          }
          
          scalar Scalar @authenticated @requiresScopes(scopes: [["f"], ["e"]])
      ` +
            OPENFED_SCOPE,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly with interface objects #1.1', () => {
      const result = federateSubgraphsSuccess([fga, fgb], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'Interface',
          requiresAuthentication: true,
          requiredScopes: [],
          requiredScopesByOR: [],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Interface',
          requiresAuthentication: true,
          requiredScopes: [['d'], ['e']],
          requiredScopesByOR: [['d'], ['e']],
        },
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'EntityOne',
          requiresAuthentication: true,
          requiredScopes: [],
          requiredScopesByOR: [],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'EntityOne',
          requiresAuthentication: true,
          requiredScopes: [['d'], ['e']],
          requiredScopesByOR: [['d'], ['e']],
        },
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'EntityTwo',
          requiresAuthentication: true,
          requiredScopes: [],
          requiredScopesByOR: [],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'EntityTwo',
          requiresAuthentication: true,
          requiredScopes: [['d'], ['e']],
          requiredScopesByOR: [['d'], ['e']],
        },
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'EntityThree',
          requiresAuthentication: true,
          requiredScopes: [],
          requiredScopesByOR: [],
        },
        {
          argumentNames: [],
          fieldName: 'isEntity',
          typeName: 'EntityThree',
          requiresAuthentication: false,
          requiredScopes: [['b']],
          requiredScopesByOR: [['b']],
        },
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'EntityThree',
          requiresAuthentication: true,
          requiredScopes: [],
          requiredScopesByOR: [],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'EntityThree',
          requiresAuthentication: true,
          requiredScopes: [['d'], ['e']],
          requiredScopesByOR: [['d'], ['e']],
        },
        {
          argumentNames: [],
          fieldName: 'entities',
          typeName: 'Query',
          requiresAuthentication: false,
          requiredScopes: [['c', 'a']],
          requiredScopesByOR: [['a'], ['c']],
        },
      ]);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            AUTHENTICATED_DIRECTIVE +
            REQUIRES_SCOPES_DIRECTIVE +
            `
        type EntityOne implements Interface @requiresScopes(scopes: [["b"]]) {
          id: ID!
          name: String!
          newField: String! @authenticated
          scalar: Scalar!
        }
        
        type EntityThree implements Interface {
          id: ID! @authenticated
          isEntity: Boolean! @requiresScopes(scopes: [["b"]])
          newField: String! @authenticated
          scalar: Scalar!
        }
        
        type EntityTwo implements Interface @authenticated {
          age: Int!
          id: ID!
          newField: String! @authenticated
          scalar: Scalar!
        }

        interface Interface @requiresScopes(scopes: [["c", "a"]]) {
          id: ID!
          newField: String! @authenticated
          scalar: Scalar!
        }
        
        type Query {
          entities: [Interface!]!
        }
        
        scalar Scalar @authenticated @requiresScopes(scopes: [["d"], ["e"]])
      ` +
            OPENFED_SCOPE,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly with interface objects #1.2', () => {
      const result = federateSubgraphsSuccess([fgb, fga], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'Interface',
          requiresAuthentication: true,
          requiredScopes: [],
          requiredScopesByOR: [],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Interface',
          requiresAuthentication: true,
          requiredScopes: [['d'], ['e']],
          requiredScopesByOR: [['d'], ['e']],
        },
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'EntityOne',
          requiresAuthentication: true,
          requiredScopes: [],
          requiredScopesByOR: [],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'EntityOne',
          requiresAuthentication: true,
          requiredScopes: [['d'], ['e']],
          requiredScopesByOR: [['d'], ['e']],
        },
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'EntityTwo',
          requiresAuthentication: true,
          requiredScopes: [],
          requiredScopesByOR: [],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'EntityTwo',
          requiresAuthentication: true,
          requiredScopes: [['d'], ['e']],
          requiredScopesByOR: [['d'], ['e']],
        },
        {
          argumentNames: [],
          fieldName: 'id',
          typeName: 'EntityThree',
          requiresAuthentication: true,
          requiredScopes: [],
          requiredScopesByOR: [],
        },
        {
          argumentNames: [],
          fieldName: 'isEntity',
          typeName: 'EntityThree',
          requiresAuthentication: false,
          requiredScopes: [['b']],
          requiredScopesByOR: [['b']],
        },
        {
          argumentNames: [],
          fieldName: 'newField',
          typeName: 'EntityThree',
          requiresAuthentication: true,
          requiredScopes: [],
          requiredScopesByOR: [],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'EntityThree',
          requiresAuthentication: true,
          requiredScopes: [['d'], ['e']],
          requiredScopesByOR: [['d'], ['e']],
        },
        {
          argumentNames: [],
          fieldName: 'entities',
          typeName: 'Query',
          requiresAuthentication: false,
          requiredScopes: [['a', 'c']],
          requiredScopesByOR: [['c'], ['a']],
        },
      ]);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            AUTHENTICATED_DIRECTIVE +
            REQUIRES_SCOPES_DIRECTIVE +
            `
        type EntityOne implements Interface @requiresScopes(scopes: [["b"]]) {
          id: ID!
          name: String!
          newField: String! @authenticated
          scalar: Scalar!
        }
        
        type EntityThree implements Interface {
          id: ID! @authenticated
          isEntity: Boolean! @requiresScopes(scopes: [["b"]])
          newField: String! @authenticated
          scalar: Scalar!
        }
        
        type EntityTwo implements Interface @authenticated {
          age: Int!
          id: ID!
          newField: String! @authenticated
          scalar: Scalar!
        }

        interface Interface @requiresScopes(scopes: [["a", "c"]]) {
          id: ID!
          newField: String! @authenticated
          scalar: Scalar!
        }
        
        type Query {
          entities: [Interface!]!
        }
        
        scalar Scalar @authenticated @requiresScopes(scopes: [["d"], ["e"]])
      ` +
            OPENFED_SCOPE,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly with renamed root types #1.1', () => {
      const result = federateSubgraphsSuccess([fha, fhb], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'enum',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [['e', 'd', 'a']],
          requiredScopesByOR: [
            ['d', 'a'],
            ['e', 'a'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [
            ['b', 'a'],
            ['c', 'a'],
          ],
          requiredScopesByOR: [
            ['b', 'a'],
            ['c', 'a'],
          ],
        },
      ]);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            AUTHENTICATED_DIRECTIVE +
            REQUIRES_SCOPES_DIRECTIVE +
            `
        enum Enum @requiresScopes(scopes: [["e", "d"]]) {
          VALUE
        }
        
        type Query {
          enum: Enum! @authenticated @requiresScopes(scopes: [["a"]])
          scalar: Scalar! @requiresScopes(scopes: [["a"]])
        }
        
        scalar Scalar @authenticated @requiresScopes(scopes: [["b"], ["c"]])
      ` +
            OPENFED_SCOPE,
        ),
      );
    });

    test('that the federated graph and its router configuration are generated correctly with renamed root types #1.2', () => {
      const result = federateSubgraphsSuccess([fhb, fha], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(result.fieldConfigurations).toStrictEqual([
        {
          argumentNames: [],
          fieldName: 'enum',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [['d', 'e', 'a']],
          requiredScopesByOR: [
            ['e', 'a'],
            ['d', 'a'],
          ],
        },
        {
          argumentNames: [],
          fieldName: 'scalar',
          typeName: 'Query',
          requiresAuthentication: true,
          requiredScopes: [
            ['b', 'a'],
            ['c', 'a'],
          ],
          requiredScopesByOR: [
            ['b', 'a'],
            ['c', 'a'],
          ],
        },
      ]);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
        normalizeString(
          SCHEMA_QUERY_DEFINITION +
            AUTHENTICATED_DIRECTIVE +
            REQUIRES_SCOPES_DIRECTIVE +
            `
        enum Enum @requiresScopes(scopes: [["d", "e"]]) {
          VALUE
        }
        
        type Query {
          enum: Enum! @authenticated @requiresScopes(scopes: [["a"]])
          scalar: Scalar! @requiresScopes(scopes: [["a"]])
        }
        
        scalar Scalar @authenticated @requiresScopes(scopes: [["b"], ["c"]])
      ` +
            OPENFED_SCOPE,
        ),
      );
    });
  });
});

const na: Subgraph = {
  name: 'na',
  url: '',
  definitions: parse(`
    type Object {
      b: Boolean!
    }
    
    type Query {
      object: Object! @authenticated
    }
  `),
};

const nb: Subgraph = {
  name: 'nb',
  url: '',
  definitions: parse(`
    type Object @authenticated {
      b: Boolean!
    }
    
    type Query {
      object: Object!
    }
  `),
};

const nc: Subgraph = {
  name: 'nc',
  url: '',
  definitions: parse(`
    type Object @requiresScopes(scopes: [["a", "b"], ["c"]]) {
      b: Boolean!
    }
    
    type Query {
      object: Object @requiresScopes(scopes: [["a"], ["b"]])
    }
  `),
};

const nd: Subgraph = {
  name: 'nd',
  url: '',
  definitions: parse(`
    type Object @requiresScopes(scopes: [["a"], ["b"], ["c"]]) {
      b: Boolean!
    }
    
    type Query {
      object: Object @requiresScopes(scopes: [["a", "b"]])
    }
  `),
};

const ne: Subgraph = {
  name: 'ne',
  url: '',
  definitions: parse(`
    type Object @authenticated @requiresScopes(scopes: [["b", "c"], ["d"]]) {
      b: Boolean! @authenticated @requiresScopes(scopes: [["f"], ["c"]])
      s: Scalar!
    }
    
    type Query {
      object: Object @authenticated @requiresScopes(scopes: [["a"], ["b"]])
    }
    
    scalar Scalar @authenticated @requiresScopes(scopes: [["c", "e"], ["d"]])
  `),
};

const nf: Subgraph = {
  name: 'nf',
  url: '',
  definitions: parse(`
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
  `),
};

const nh: Subgraph = {
  name: 'nh',
  url: '',
  definitions: parse(`
    type Query {
      scalar: Scalar! @requiresScopes(scopes: [["a"], ["b"], ["c"]])
    }
    
    scalar Scalar @requiresScopes(scopes: [["a"], ["b"], ["c"]])
  `),
};

const ni: Subgraph = {
  name: 'ni',
  url: '',
  definitions: parse(`
    type Query {
      scalar: Scalar! @requiresScopes(scopes: [["a"], ["b"], ["c"]])
    }
    
    scalar Scalar @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"]])
  `),
};

const nj: Subgraph = {
  name: 'nj',
  url: '',
  definitions: parse(`
    type Query {
      scalar: Scalar! @requiresScopes(scopes: [["a", "b", "c"]])
    }
    
    scalar Scalar @requiresScopes(scopes: [["a", "b"], ["a"]])
  `),
};

const faa: Subgraph = {
  name: 'faa',
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

const fab: Subgraph = {
  name: 'fab',
  url: '',
  definitions: parse(`
    type Object @key(fields: "id") {
      id: ID!
      age: Int!
    }
  `),
};

const fac: Subgraph = {
  name: 'fac',
  url: '',
  definitions: parse(`
    type Query {
      object: Object!
    }
    
    type Object @key(fields: "id") @requiresScopes(scopes: [["b"]]) {
      id: ID!
      name: String!
    }
  `),
};

const fad: Subgraph = {
  name: 'fad',
  url: '',
  definitions: parse(`
    type Query {
      object: Object!
    }
    
    type Object @key(fields: "id") @requiresScopes(scopes: [["b"]]) {
      id: ID!
      name: String! @authenticated
    }
  `),
};

const fca: Subgraph = {
  name: 'fca',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Entity!]!
      scalar: Scalar
    }
    
    type Entity @key(fields: "id") @authenticated @requiresScopes(scopes: [["b"]]) {
      id: ID!
      name: String!
    }
    
    scalar Scalar
  `),
};

const fcb: Subgraph = {
  name: 'fcb',
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

const fda: Subgraph = {
  name: 'fda',
  url: '',
  definitions: parse(`
    type Query {
      enum: Enum! @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"]])
      scalar: Scalar! @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"]])
    }
    
    interface Interface @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"]]) {
      name: String!
    }

    type Object implements Interface @requiresScopes(scopes: [["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"]]) {
      name: String!
    }

    enum Enum @requiresScopes(scopes: [["i"], ["j"], ["k"], ["l"], ["m"], ["n"], ["o"], ["p"], ["q"]]) {
      VALUE
    }
    
    scalar Scalar @requiresScopes(scopes: [["i"], ["j"], ["k"], ["l"], ["m"], ["n"], ["o"], ["p"], ["q"]])
  `),
};

const fea: Subgraph = {
  name: 'fea',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
      scalar: Scalar!
    }
    
    interface Interface @requiresScopes(scopes: [["g", "h"], ["d"]]) {
      id: ID!
      scalar: Scalar!
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      scalar: Scalar!
    }
    
    scalar Scalar @requiresScopes(scopes: [["e"]])
  `),
};

const feb: Subgraph = {
  name: 'feb',
  url: '',
  definitions: parse(`
    interface Interface @requiresScopes(scopes: [["i", "c"], ["h", "c"]]) @authenticated {
      id: ID!
      age: Int!
      scalarTwo: Scalar!
    }

    type Entity implements Interface @key(fields: "id") @requiresScopes(scopes: [["b"], ["d"]]) {
      id: ID!
      age: Int!
      scalarTwo: Scalar!
    }
    
    type Query {
      interfaces: [Interface!]!
    }
    
    scalar Scalar @requiresScopes(scopes: [["j"]])
  `),
};

const ffa: Subgraph = {
  name: 'ffa',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
    }
    
    type Entity @key(fields: "id") @requiresScopes(scopes: [["a"]]) {
      id: ID!
      name: String!
    }
    
    extend type Entity @authenticated {
      age: Int!
    }
  `),
};

const ffb: Subgraph = {
  name: 'ffb',
  url: '',
  definitions: parse(`
    extend type Entity @requiresScopes(scopes: [["b"]]) {
      scalar: Scalar! @requiresScopes(scopes: [["c"], ["d"]])
    }
    
    type Entity @key(fields: "id") @authenticated {
      id: ID!
      isEntity: Boolean! @requiresScopes(scopes: [["e"]])
    }
    
    scalar Scalar
    
    extend scalar Scalar @authenticated
    
    extend scalar Scalar @requiresScopes(scopes: [["f"], ["e"]])
  `),
};

const fba: Subgraph = {
  name: 'fba',
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

const fbb: Subgraph = {
  name: 'fbb',
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

const fga: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    type Query {
      entities: [Interface!]!
    }
    
    interface Interface @key(fields: "id") @requiresScopes(scopes: [["a"]]) {
      id: ID!
    }
    
    type EntityOne implements Interface @key(fields: "id") @requiresScopes(scopes: [["b"]]) {
      id: ID!
      name: String!
    }
    
    type EntityTwo implements Interface @key(fields: "id") @authenticated {
      id: ID!
      age: Int!
    }
    
    type EntityThree implements Interface @key(fields: "id") {
      id: ID! @authenticated
      isEntity: Boolean! @requiresScopes(scopes: [["b"]])
    }
  `),
};

const fgb: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    type Interface @key(fields: "id") @interfaceObject @requiresScopes(scopes: [["c"]]) {
      id: ID!
      newField: String! @authenticated
      scalar: Scalar!
    }
    
    scalar Scalar @authenticated @requiresScopes(scopes: [["d"], ["e"]])
  `),
};

const fha: Subgraph = {
  name: 'fha',
  url: '',
  definitions: parse(`
     schema {
      query: Queries
    }
    
    type Queries @shareable {
      enum: Enum! @requiresScopes(scopes: [["a"]])
      scalar: Scalar! @requiresScopes(scopes: [["a"]])
    }
    
    enum Enum @requiresScopes(scopes: [["d"]]) {
      VALUE
    }
    
    scalar Scalar @requiresScopes(scopes: [["b"], ["c"]])
  `),
};

const fhb: Subgraph = {
  name: 'fhb',
  url: '',
  definitions: parse(`
    schema {
      query: MyQuery
    }
    
    type MyQuery @shareable {
      enum: Enum! @authenticated
      scalar: Scalar!
    }
    
    enum Enum @requiresScopes(scopes: [["e"]]) {
      VALUE
    }
    
    scalar Scalar @authenticated
  `),
};

const fiaa: Subgraph = {
  name: 'fiaa',
  url: '',
  definitions: parse(`
    enum Enum @authenticated {
      A
    }
    
    type Query {
      a: Enum!
      b: Enum!
    }
  `),
};

const fiab: Subgraph = {
  name: 'fiab',
  url: '',
  definitions: parse(`
    enum Enum {
      A
    }
    
    type Query {
      c: Enum!
    }
  `),
};

const fjaa: Subgraph = {
  name: 'fjaa',
  url: '',
  definitions: parse(`
    interface Interface @authenticated {
      a: ID
    }
    
    type Object implements Interface @shareable {
      a: ID
    }
    
    type Query {
      a: Interface!
      b: Interface!
      c: Object!
    }
  `),
};

const fjab: Subgraph = {
  name: 'fjab',
  url: '',
  definitions: parse(`
    interface Interface {
      a: ID
    }
    
    type Object implements Interface {
      a: ID
    }
    
    type Query {
      d: Interface!
      e: Object!
    }
  `),
};

const fkaa: Subgraph = {
  name: 'fkaa',
  url: '',
  definitions: parse(`
    type Object @authenticated @shareable {
      a: ID
    }
    
    type Query {
      a: Object!
      b: Object!
    }
  `),
};

const fkab: Subgraph = {
  name: 'fkab',
  url: '',
  definitions: parse(`
    type Object {
      a: ID
    }
    
    type Query {
      c: Object!
    }
  `),
};

const flaa: Subgraph = {
  name: 'flaa',
  url: '',
  definitions: parse(`
    type Query {
      a: Scalar!
      b: Scalar!
    }
    
    scalar Scalar @authenticated
  `),
};

const flab: Subgraph = {
  name: 'flab',
  url: '',
  definitions: parse(`
    type Query {
      c: Scalar!
    }
    
    scalar Scalar
  `),
};

const fmaa: Subgraph = {
  name: 'fmaa',
  url: '',
  definitions: parse(`
    interface Interface {
      a: ID @authenticated
    }
    
    type Object implements Interface @shareable {
      a: ID
    }
    
    type Query {
      a: Interface!
      b: Interface!
      c: Object!
    }
  `),
};

const fmab: Subgraph = {
  name: 'fmab',
  url: '',
  definitions: parse(`
    interface Interface {
      a: ID
    }
    
    type Object implements Interface {
      a: ID
    }
    
    type Query {
      d: Interface!
      e: Object!
    }
  `),
};

const fnaa: Subgraph = {
  name: 'fnaa',
  url: '',
  definitions: parse(`
    type Object @shareable {
      a: ID @authenticated
    }
    
    type Query {
      a: Object!
      b: Object!
    }
  `),
};

const fnab: Subgraph = {
  name: 'fnab',
  url: '',
  definitions: parse(`
    type Object {
      a: ID
    }
    
    type Query {
      c: Object!
    }
  `),
};

const foaa: Subgraph = {
  name: 'foaa',
  url: '',
  definitions: parse(`
    interface Interface {
      id: ID! @requiresScopes(scopes: [["read:id"]])
      name: String!
    }
    
    type Object implements Interface {
      id: ID!
      name: String!
    }
    
    type Query {
      interfaces: [Interface!]!
      objects: [Object!]!
    }
  `),
};

const fpaa: Subgraph = {
  name: 'fpaa',
  url: '',
  definitions: parse(`
    type Query @shareable {
      scalars: [Scalar!]! @requiresScopes(scopes: [["a", "b"], ["c"]])
    }
    
    scalar Scalar @requiresScopes(scopes: [["d", "e"], ["f"]])
  `),
};

const fpab: Subgraph = {
  name: 'fpab',
  url: '',
  definitions: parse(`
    type Query @shareable {
      scalars: [Scalar!]! @requiresScopes(scopes: [["g", "h"], ["i"]])
    }
    
    scalar Scalar @requiresScopes(scopes: [["j", "k"], ["l"]])
  `),
};

const fqaa: Subgraph = {
  name: 'fqaa',
  url: '',
  definitions: parse(`
    type Query @shareable {
      ids: [ID!]! @requiresScopes(scopes: [["a"], ["b"]])
    }
  `),
};

const fqab: Subgraph = {
  name: 'fqab',
  url: '',
  definitions: parse(`
    type Query @shareable {
      ids: [ID!]! @requiresScopes(scopes: [["a"], ["b"]])
    }
  `),
};

const fqac: Subgraph = {
  name: 'fqac',
  url: '',
  definitions: parse(`
    type Query @shareable {
      ids: [ID!]! @requiresScopes(scopes: [["a"], ["b"], ["c"]])
    }
  `),
};
