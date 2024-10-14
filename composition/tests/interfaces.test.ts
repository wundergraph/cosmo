import {
  duplicateFieldDefinitionError,
  federateSubgraphs,
  ImplementationErrors,
  incompatibleFederatedFieldNamedTypeError,
  INTERFACE,
  InvalidFieldImplementation,
  invalidImplementedTypeError,
  invalidInterfaceImplementationError,
  noBaseDefinitionForExtensionError,
  noFieldDefinitionsError,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  OBJECT,
  parse,
  SCALAR,
  selfImplementationError,
  Subgraph,
  unimplementedInterfaceOutputTypeError,
} from '../src';
import { describe, expect, test } from 'vitest';
import {
  baseDirectiveDefinitions,
  normalizeString,
  schemaQueryDefinition,
  schemaToSortedNormalizedString,
  versionOneRouterDefinitions,
  versionTwoRouterDefinitions,
} from './utils/utils';

describe('Interface tests', () => {
  describe('Normalization tests', () => {
    test('that an Interface extension orphan is valid', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphR.definitions, subgraphR.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          interface Interface {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Interface can be extended #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphAE.definitions, subgraphAE.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          interface Interface {
            age: Int!
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Interface can be extended #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphAF.definitions, subgraphAF.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          interface Interface {
            age: Int!
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Interface stub can be extended #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphV.definitions, subgraphV.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          interface Interface {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Interface stub can be extended #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphW.definitions, subgraphW.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          interface Interface {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Interface stub can be extended #3', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphX.definitions, subgraphX.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          interface Interface @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Interface stub can be extended #4', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphY.definitions, subgraphY.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          interface Interface @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Interface stub can be extended #5', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphZ.definitions, subgraphZ.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          interface Interface @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Interface can be extended with just a directive #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphAA.definitions, subgraphAA.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          interface Interface @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Interface can be extended with just a directive #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphAB.definitions, subgraphAB.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          interface Interface @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Interface extension can be extended with just a directive #1', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphAC.definitions, subgraphAC.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          interface Interface @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an Interface extension can be extended with just a directive #2', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphAD.definitions, subgraphAD.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          baseDirectiveDefinitions +
            `
          interface Interface @tag(name: "name") {
            name: String!
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });

    test('that an error is returned if a final Interface does not define any Fields', () => {
      const { errors } = normalizeSubgraph(subgraphI.definitions, subgraphI.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noFieldDefinitionsError(INTERFACE, INTERFACE));
    });

    test('that an error is returned if a final Interface extension does not define any Fields', () => {
      const { errors } = normalizeSubgraph(subgraphJ.definitions, subgraphJ.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noFieldDefinitionsError(INTERFACE, INTERFACE));
    });

    test('that an error is returned if a final extended Interface does not define any Fields #1', () => {
      const { errors } = normalizeSubgraph(subgraphK.definitions, subgraphK.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noFieldDefinitionsError(INTERFACE, INTERFACE));
    });

    test('that an error is returned if a final extended Interface does not define any Fields #2', () => {
      const { errors } = normalizeSubgraph(subgraphL.definitions, subgraphL.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noFieldDefinitionsError(INTERFACE, INTERFACE));
    });

    test('that an error is returned if an Interface defines a duplicate Field', () => {
      const { errors } = normalizeSubgraph(subgraphM.definitions, subgraphM.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateFieldDefinitionError(INTERFACE, INTERFACE, 'name'));
    });

    test('that an error is returned if an Interface extension defines a duplicate Field', () => {
      const { errors } = normalizeSubgraph(subgraphN.definitions, subgraphN.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateFieldDefinitionError(INTERFACE, INTERFACE, 'name'));
    });

    test('that an error is returned if an extended Interface defines a duplicate Field #1', () => {
      const { errors } = normalizeSubgraph(subgraphO.definitions, subgraphO.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateFieldDefinitionError(INTERFACE, INTERFACE, 'name'));
    });

    test('that an error is returned if an extended Interface defines a duplicate Field #2', () => {
      const { errors } = normalizeSubgraph(subgraphP.definitions, subgraphP.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(duplicateFieldDefinitionError(INTERFACE, INTERFACE, 'name'));
    });

    test('that errors are returned if implemented Interface Fields are invalid #1', () => {
      const { errors } = normalizeSubgraphFromString(`
        interface Animal {
          name: String!
          sounds(species: String!): [String!]
        }
          
        interface Pet implements Animal {
          age: Int!
          isDog: Boolean!
          name: String!
          sounds(species: String): [String]!
        }
        
        type Cat implements Pet & Animal {
          isDog: Boolean! @inaccessible
          isPurring: Boolean!
          sounds: [String!]!
        }
      `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(2);
      expect(errors![0]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Pet',
          INTERFACE,
          new Map<string, ImplementationErrors>([
            [
              'Animal',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'sounds',
                    {
                      implementedResponseType: '[String]!',
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [
                        { actualType: 'String', argumentName: 'species', expectedType: 'String!' },
                      ],
                      isInaccessible: false,
                      originalResponseType: '[String!]',
                      unimplementedArguments: new Set<string>(),
                    },
                  ],
                ]),
                unimplementedFields: [],
              },
            ],
          ]),
        ),
      );
      expect(errors![1]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Cat',
          OBJECT,
          new Map<string, ImplementationErrors>([
            [
              'Pet',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'isDog',
                    {
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [],
                      isInaccessible: true,
                      originalResponseType: 'Boolean!',
                      unimplementedArguments: new Set<string>(),
                    },
                  ],
                  [
                    'sounds',
                    {
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [],
                      isInaccessible: false,
                      originalResponseType: '[String]!',
                      unimplementedArguments: new Set<string>(['species']),
                    },
                  ],
                ]),
                unimplementedFields: ['age', 'name'],
              },
            ],
            [
              'Animal',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'sounds',
                    {
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [],
                      isInaccessible: false,
                      originalResponseType: '[String!]',
                      unimplementedArguments: new Set<string>(['species']),
                    },
                  ],
                ]),
                unimplementedFields: ['name'],
              },
            ],
          ]),
        ),
      );
    });

    test('that errors are returned if implemented interface fields are invalid #2', () => {
      const { errors } = normalizeSubgraphFromString(`
        interface Animal {
          name: String!
          sound(a: String!, b: Int, c: Float, d: Boolean): String!
        }
          
        interface Pet implements Animal {
          age: Int!
          sound(a: Int, b: String!): String!
        }
        
        extend interface Pet {
          price: Float
          name: String!
        }
        
        type Cat implements Pet & Animal {
          isPurring: Boolean!
          sound(e: Int!): String!
        }
        
        extend type Cat {
          name: String!
        }  
      `);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(2);
      expect(errors![0]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Pet',
          INTERFACE,
          new Map<string, ImplementationErrors>([
            [
              'Animal',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'sound',
                    {
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [
                        { actualType: 'Int', argumentName: 'a', expectedType: 'String!' },
                        { actualType: 'String!', argumentName: 'b', expectedType: 'Int' },
                      ],
                      isInaccessible: false,
                      originalResponseType: 'String!',
                      unimplementedArguments: new Set<string>(['c', 'd']),
                    },
                  ],
                ]),
                unimplementedFields: [],
              },
            ],
          ]),
        ),
      );
      expect(errors![1]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Cat',
          OBJECT,
          new Map<string, ImplementationErrors>([
            [
              'Pet',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'sound',
                    {
                      invalidAdditionalArguments: new Set<string>(['e']),
                      invalidImplementedArguments: [],
                      isInaccessible: false,
                      originalResponseType: 'String!',
                      unimplementedArguments: new Set<string>(['a', 'b']),
                    },
                  ],
                ]),
                unimplementedFields: ['age', 'price'],
              },
            ],
            [
              'Animal',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'sound',
                    {
                      invalidAdditionalArguments: new Set<string>(['e']),
                      invalidImplementedArguments: [],
                      isInaccessible: false,
                      originalResponseType: 'String',
                      unimplementedArguments: new Set<string>(['a', 'b', 'c', 'd']),
                    },
                  ],
                ]),
                unimplementedFields: [],
              },
            ],
          ]),
        ),
      );
    });

    test('that an error is returned if a type attempts to implement a type that is not an interface', () => {
      const { errors } = normalizeSubgraph(subgraphG.definitions, subgraphG.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(
        invalidImplementedTypeError(
          OBJECT,
          new Map<string, string>([
            [INTERFACE, OBJECT],
            [SCALAR, SCALAR],
          ]),
        ),
      );
    });

    test('that an error is returned if an interface attempts to implement itself', () => {
      const { errors } = normalizeSubgraph(subgraphH.definitions, subgraphH.name);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(selfImplementationError('Interface'));
    });

    // TODO currently a warning until @inaccessible and entity interfaces are handled
    test.skip('that an error is returned if a Field returns an Interface without any implementations', () => {
      const { errors } = normalizeSubgraph(subgraphAM.definitions, subgraphAM.name);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(unimplementedInterfaceOutputTypeError('Interface'));
    });

    test('that an Interface without implementations is valid if it not used as an output type', () => {
      const { errors, normalizationResult } = normalizeSubgraph(subgraphAN.definitions, subgraphAN.name);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            baseDirectiveDefinitions +
            `
          interface Interface {
            name: String!
          }
          
          type Query {
            dummy: String!
          }

          scalar openfed__FieldSet
        `,
        ),
      );
    });
  });

  describe('Federation tests', () => {
    test('that an Interface type and extension definition federate successfully #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphQ, subgraphR, subgraphU]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          interface Interface {
            age: Int!
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    test('that an Interface type and extension definition federate successfully #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphQ, subgraphU, subgraphR]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          interface Interface {
            age: Int!
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    test('that Interfaces merge by union', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
      interface Character {
        age: Int!
        isFriend: Boolean!
        name: String!
      }

      type Query {
        dummy: String!
      }

      type Rival implements Character {
        age: Int!
        isFriend: Boolean!
        name: String!
      }
      
      type Trainer implements Character {
        age: Int!
        badges: Int!
        isFriend: Boolean!
        name: String!
      }

      scalar openfed__Scope
    `,
        ),
      );
    });

    test('that Interfaces and implementations merge by union', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphA, subgraphC]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
      interface Character {
        age: Int!
        isFriend: Boolean!
        name: String!
      }
      
      interface Human {
        name: String!
      }

      type Query {
        dummy: String!
      }

      type Trainer implements Character & Human {
        age: Int!
        badges: Int!
        isFriend: Boolean!
        name: String!
      }
      
      scalar openfed__Scope
    `,
        ),
      );
    });

    test('that nested Interfaces merge by union', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphD]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
      interface Character {
        isFriend: Boolean!
      }

      interface Human implements Character {
        isFriend: Boolean!
        name: String!
      }

      type Query {
        dummy: String!
      }

      type Trainer implements Character & Human {
        isFriend: Boolean!
        name: String!
      }
      
      scalar openfed__Scope
    `,
        ),
      );
    });

    test('that errors are returned if implemented Interface Fields are invalid #1', () => {
      const { errors } = federateSubgraphs([subgraphE, subgraphF]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(2);
      expect(errors![0]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Cat',
          OBJECT,
          new Map<string, ImplementationErrors>([
            [
              'Pet',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
                unimplementedFields: ['name'],
              },
            ],
            [
              'Animal',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>(),
                unimplementedFields: ['name'],
              },
            ],
          ]),
        ),
      );
      expect(errors![1]).toStrictEqual(
        invalidInterfaceImplementationError(
          'Dog',
          OBJECT,
          new Map<string, ImplementationErrors>([
            [
              'Pet',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'sounds',
                    {
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [
                        { actualType: 'String', argumentName: 'a', expectedType: 'String!' },
                        { actualType: 'Int', argumentName: 'b', expectedType: 'Int!' },
                      ],
                      isInaccessible: false,
                      originalResponseType: 'String',
                      unimplementedArguments: new Set<string>(),
                    },
                  ],
                ]),
                unimplementedFields: ['age'],
              },
            ],
            [
              'Animal',
              {
                invalidFieldImplementations: new Map<string, InvalidFieldImplementation>([
                  [
                    'sounds',
                    {
                      invalidAdditionalArguments: new Set<string>(),
                      invalidImplementedArguments: [
                        { actualType: 'String', argumentName: 'a', expectedType: 'String!' },
                        { actualType: 'Int', argumentName: 'b', expectedType: 'Int!' },
                      ],
                      isInaccessible: false,
                      originalResponseType: 'String',
                      unimplementedArguments: new Set<string>(),
                    },
                  ],
                ]),
                unimplementedFields: [],
              },
            ],
          ]),
        ),
      );
    });

    test('that an error is returned if federation results in an Interface extension orphan', () => {
      const { errors } = federateSubgraphs([subgraphQ, subgraphR]);
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(noBaseDefinitionForExtensionError(INTERFACE, INTERFACE));
    });

    test('that a V1 Interface with @extends directive federates with a base definition #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphQ, subgraphS, subgraphU]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          interface Interface {
            age: Int!
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    test('that a V1 Interface with @extends directive federates with a base definition #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphQ, subgraphU, subgraphS]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
          interface Interface {
            age: Int!
            name: String!
          }
          
          type Query {
            dummy: String!
          }
        `,
        ),
      );
    });

    test('that an error is returned if federation results in a V1 Interface with @extends directive orphan #1', () => {
      const { errors } = federateSubgraphs([subgraphQ, subgraphS]);
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(noBaseDefinitionForExtensionError(INTERFACE, INTERFACE));
    });

    test('that an error is returned if federation results in a V1 Interface with @extends directive orphan #2.1', () => {
      const { errors } = federateSubgraphs([subgraphQ, subgraphR, subgraphS]);
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(noBaseDefinitionForExtensionError(INTERFACE, INTERFACE));
    });

    test('that an error is returned if federation results in a V1 Interface with @extends directive orphan #2.2', () => {
      const { errors } = federateSubgraphs([subgraphQ, subgraphS, subgraphR]);
      expect(errors).toHaveLength(1);
      expect(errors![0]).toStrictEqual(noBaseDefinitionForExtensionError(INTERFACE, INTERFACE));
    });

    test('that a V2 Interface @extends directive orphan is valid #1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphQ, subgraphT]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          scalar Dummy @inaccessible
          
          interface Interface {
            name: String!
          }
          
          type Query {
            dummy: String!
          }

          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that a V2 Interface @extends directive orphan is valid with another base type #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphQ, subgraphT, subgraphU]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
                scalar Dummy @inaccessible

                interface Interface {
                  age: Int!
                  name: String!
                }

                type Query {
                  dummy: String!
                }

                scalar openfed__Scope
        `,
        ),
      );
    });

    test('that a V2 Interface @extends directive orphan is valid with another base type #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphQ, subgraphT, subgraphU]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
                scalar Dummy @inaccessible

                interface Interface {
                  age: Int!
                  name: String!
                }

                type Query {
                  dummy: String!
                }

                scalar openfed__Scope
        `,
        ),
      );
    });

    test('that a V2 Interface @extends directive orphan is valid with another extension #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphQ, subgraphR, subgraphT]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          scalar Dummy @inaccessible

          interface Interface {
            name: String!
          }
          
          type Query {
            dummy: String!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that a V2 Interface @extends directive orphan is valid with another extension #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphQ, subgraphT, subgraphR]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          scalar Dummy @inaccessible

          interface Interface {
            name: String!
          }
          
          type Query {
            dummy: String!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that Field named types can coerce implementing types into Interfaces #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphAG, subgraphAH]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
              interface AnotherInterface {
                name: String!
              }

              type AnotherObject implements AnotherInterface {
                name: String!
              }

              interface Interface {
                name: String!
              }

              type Object implements Interface {
                name: String!
                nested: [AnotherInterface]!
              }

              type Query {
                interface: Interface!
              }

              scalar openfed__Scope
        `,
        ),
      );
    });

    test('that Field named types can coerce implementing types into Interfaces #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphAH, subgraphAG]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          interface AnotherInterface {
            name: String!
          }
          
          type AnotherObject implements AnotherInterface {
            name: String!
          }
          
          interface Interface {
            name: String!
          }
          
          type Object implements Interface {
            name: String!
            nested: [AnotherInterface]!
          }
          
          type Query {
            interface: Interface!
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that Field named types can coerce a single implementing type into Interfaces #2.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphAI, subgraphAK, subgraphAL]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
          interface AnotherInterface {
            name: String!
          }
          
          type AnotherObject implements AnotherInterface & Interface {
            name: String!
          }
          
          interface Interface implements AnotherInterface {
            name: String!
          }
          
          type Object implements AnotherInterface & Interface {
            name: String!
          }
          
          type Query {
            anotherInterface: AnotherInterface!
            interface: [Interface]
          }
          
          scalar openfed__Scope
        `,
        ),
      );
    });

    test('that Field named types can coerce a single implementing types into Interfaces #2.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphAL, subgraphAK, subgraphAI]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionTwoRouterDefinitions +
            `
              interface AnotherInterface {
                name: String!
              }

              type AnotherObject implements AnotherInterface & Interface {
                name: String!
              }

              interface Interface implements AnotherInterface {
                name: String!
              }

              type Object implements AnotherInterface & Interface {
                name: String!
              }

              type Query {
                anotherInterface: AnotherInterface!
                interface: [Interface]
              }

              scalar openfed__Scope
        `,
        ),
      );
    });

    test('that Field named types cannot coerce more than one implementing type into Interfaces #3.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphAI, subgraphAJ, subgraphAK, subgraphAL]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(2);
      expect(errors![0]).toStrictEqual(
        incompatibleFederatedFieldNamedTypeError(
          'Query.anotherInterface',
          new Map<string, Set<string>>([
            ['Object', new Set<string>(['subgraph-ai'])],
            ['AnotherObject', new Set<string>(['subgraph-aj'])],
            ['Interface', new Set<string>(['subgraph-ak'])],
            ['AnotherInterface', new Set<string>(['subgraph-al'])],
          ]),
        ),
      );
      expect(errors![1]).toStrictEqual(
        incompatibleFederatedFieldNamedTypeError(
          'Query.interface',
          new Map<string, Set<string>>([
            ['Object', new Set<string>(['subgraph-ai'])],
            ['AnotherObject', new Set<string>(['subgraph-aj'])],
            ['Interface', new Set<string>(['subgraph-al'])],
          ]),
        ),
      );
    });

    test('that Field named types cannot coerce more than one implementing type into Interfaces #3.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphAL, subgraphAK, subgraphAJ, subgraphAI]);
      expect(errors).toBeDefined();
      expect(errors).toHaveLength(2);
      expect(errors![0]).toStrictEqual(
        incompatibleFederatedFieldNamedTypeError(
          'Query.anotherInterface',
          new Map<string, Set<string>>([
            ['AnotherInterface', new Set<string>(['subgraph-al'])],
            ['Interface', new Set<string>(['subgraph-ak'])],
            ['AnotherObject', new Set<string>(['subgraph-aj'])],
            ['Object', new Set<string>(['subgraph-ai'])],
          ]),
        ),
      );
      expect(errors![1]).toStrictEqual(
        incompatibleFederatedFieldNamedTypeError(
          'Query.interface',
          new Map<string, Set<string>>([
            ['Interface', new Set<string>(['subgraph-al'])],
            ['AnotherObject', new Set<string>(['subgraph-aj'])],
            ['Object', new Set<string>(['subgraph-ai'])],
          ]),
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
      dummy: String! @shareable
    }

    interface Character {
      name: String!
    }
    
    extend interface Character {
      age: Int!
    }

    type Trainer implements Character {
      name: String! @shareable
      age: Int!
      badges: Int!
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    interface Character {
      isFriend: Boolean!
    }

    type Rival implements Character {
      name: String!
      age: Int!
      isFriend: Boolean!
    }

    type Trainer implements Character {
      isFriend: Boolean!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String! @shareable
    }

    interface Character {
      isFriend: Boolean!
    }

    interface Human {
      name: String!
    }

    type Trainer implements Character & Human @shareable {
      name: String!
      isFriend: Boolean!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    interface Character {
      isFriend: Boolean!
    }

    interface Human implements Character {
      name: String!
      isFriend: Boolean!
    }

    type Trainer implements Character & Human @shareable {
      name: String!
      isFriend: Boolean!
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-e',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }

    interface Animal {
      sounds(a: String!, b: Int!): [String]
    }
      
    interface Pet implements Animal {
      age: Int!
      sounds(a: String!, b: Int!): [String]!
    }
    
    type Cat implements Pet & Animal {
      age: Int!
      isPurring: Boolean!
      sounds(a: String!, b: Int!): [String!]!
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    interface Animal {
      name: String!
      sounds(a: String, b: Int): [String]
    }
      
    interface Pet implements Animal {
      name: String!
      sounds(a: String, b: Int): [String]
    }
    
    type Dog implements Pet & Animal {
      name: String!
      sounds(a: String, b: Int): [String!]
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    type Object implements Interface & Scalar {
      name: String!
    }
    
    type Interface {
      name: String!
    }
    
    scalar Scalar
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    interface Interface implements Interface {
      name: String!
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    interface Interface
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    extend interface Interface @tag(name: "test")
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    interface Interface
    extend interface Interface @tag(name: "test")
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    extend interface Interface @tag(name: "test")
    interface Interface
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    interface Interface {
      name: String!
      name: String!
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    extend interface Interface {
      name: String!
      name: String!
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    interface Interface {
      name: String!
    }
    
    extend interface Interface {
      name: String!
    }
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    extend interface Interface {
      name: String!
    }
    
    interface Interface {
      name: String!
    }
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
  `),
};

const subgraphR: Subgraph = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    extend interface Interface {
      name: String!
    }
  `),
};

const subgraphS: Subgraph = {
  name: 'subgraph-s',
  url: '',
  definitions: parse(`
    interface Interface @extends {
      name: String!
    }
  `),
};

const subgraphT: Subgraph = {
  name: 'subgraph-t',
  url: '',
  definitions: parse(`
    interface Interface @extends {
      name: String!
    }
    
    scalar Dummy @inaccessible
  `),
};

const subgraphU: Subgraph = {
  name: 'subgraph-u',
  url: '',
  definitions: parse(`
    interface Interface {
      age: Int!
    }
  `),
};

const subgraphV: Subgraph = {
  name: 'subgraph-v',
  url: '',
  definitions: parse(`
    interface Interface
    
    extend interface Interface {
      name: String!
    }
  `),
};

const subgraphW: Subgraph = {
  name: 'subgraph-w',
  url: '',
  definitions: parse(`
    extend interface Interface {
      name: String!
    }
    
    interface Interface
  `),
};

const subgraphX: Subgraph = {
  name: 'subgraph-x',
  url: '',
  definitions: parse(`
    interface Interface
    
    extend interface Interface {
      name: String!
    }
    
    extend interface Interface @tag(name: "name")
  `),
};

const subgraphY: Subgraph = {
  name: 'subgraph-y',
  url: '',
  definitions: parse(`
    extend interface Interface {
      name: String!
    }
    
    interface Interface
    
    extend interface Interface @tag(name: "name")
  `),
};

const subgraphZ: Subgraph = {
  name: 'subgraph-z',
  url: '',
  definitions: parse(`
    extend interface Interface @tag(name: "name")
    
    extend interface Interface {
      name: String!
    }
    
    interface Interface
  `),
};

const subgraphAA: Subgraph = {
  name: 'subgraph-aa',
  url: '',
  definitions: parse(`
    interface Interface {
      name: String!
    }
    
    extend interface Interface @tag(name: "name")
  `),
};

const subgraphAB: Subgraph = {
  name: 'subgraph-ab',
  url: '',
  definitions: parse(`
    extend interface Interface @tag(name: "name")
    
    interface Interface {
      name: String!
    }
  `),
};

const subgraphAC: Subgraph = {
  name: 'subgraph-ac',
  url: '',
  definitions: parse(`
    extend interface Interface {
      name: String!
    }

    extend interface Interface @tag(name: "name")
  `),
};

const subgraphAD: Subgraph = {
  name: 'subgraph-ad',
  url: '',
  definitions: parse(`
    extend interface Interface @tag(name: "name")
    
    extend interface Interface {
      name: String!
    }
  `),
};

const subgraphAE: Subgraph = {
  name: 'subgraph-ae',
  url: '',
  definitions: parse(`
    interface Interface {
      age: Int!
    }
    
    extend interface Interface {
      name: String!
    }
  `),
};

const subgraphAF: Subgraph = {
  name: 'subgraph-af',
  url: '',
  definitions: parse(`
    extend interface Interface {
      name: String!
    }
    
    interface Interface {
      age: Int!
    }
  `),
};

const subgraphAG: Subgraph = {
  name: 'subgraph-ag',
  url: '',
  definitions: parse(`
    interface AnotherInterface {
      name: String!
    }
    
    interface Interface {
      name: String!
    }
    
    type AnotherObject implements AnotherInterface @shareable {
      name: String!
    }
    
    type Object implements Interface @shareable {
      name: String!
      nested: [AnotherInterface]!
    }
    
    type Query {
      interface: Interface! @shareable
    }
  `),
};

const subgraphAH: Subgraph = {
  name: 'subgraph-ah',
  url: '',
  definitions: parse(`
    type AnotherObject @shareable {
      name: String!
    }
    
    type Object @shareable {
      name: String!
      nested: [AnotherObject!]!
    }
    
    type Query {
      interface: Object! @shareable
    }
  `),
};

const subgraphAI: Subgraph = {
  name: 'subgraph-ai',
  url: '',
  definitions: parse(`
    type Object @shareable {
      name: String!
    }
    
    type Query @shareable {
      anotherInterface: Object!
      interface: [Object!]!
    }
  `),
};

const subgraphAJ: Subgraph = {
  name: 'subgraph-aj',
  url: '',
  definitions: parse(`
    type AnotherObject @shareable {
      name: String!
    }
    
    type Query @shareable {
      anotherInterface: AnotherObject!
      interface: [AnotherObject!]!
    }
  `),
};

const subgraphAK: Subgraph = {
  name: 'subgraph-ak',
  url: '',
  definitions: parse(`
    interface Interface {
      name: String!
    }
    
    type AnotherObject implements Interface @shareable {
      name: String!
    }
    
    type Object implements Interface @shareable {
      name: String!
    }
    
    type Query @shareable {
      anotherInterface: Interface!
    }
  `),
};

const subgraphAL: Subgraph = {
  name: 'subgraph-al',
  url: '',
  definitions: parse(`
    interface AnotherInterface {
      name: String!
    }

    interface Interface implements AnotherInterface {
      name: String!
    }

    type AnotherObject implements Interface & AnotherInterface @shareable {
      name: String!
    }

    type Object implements Interface & AnotherInterface @shareable {
      name: String!
    }
    
    type Query @shareable {
      interface: [Interface]
      anotherInterface: AnotherInterface!
    }
  `),
};

const subgraphAM: Subgraph = {
  name: 'subgraph-am',
  url: '',
  definitions: parse(`
    interface Interface {
      name: String!
    }
    
    type Query {
      interface: Interface!
    }
  `),
};

const subgraphAN: Subgraph = {
  name: 'subgraph-an',
  url: '',
  definitions: parse(`
    interface Interface {
      name: String!
    }
    
    type Query{
      dummy: String!
    }
  `),
};
