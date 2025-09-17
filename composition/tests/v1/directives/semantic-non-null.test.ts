import { describe, expect, test } from 'vitest';
import {
  FieldData,
  ID_SCALAR,
  invalidDirectiveError,
  parse,
  QUERY,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  SEMANTIC_NON_NULL,
  semanticNonNullInconsistentLevelsError,
  semanticNonNullLevelsIndexOutOfBoundsErrorMessage,
  semanticNonNullLevelsNonNullErrorMessage,
  Subgraph,
  SubgraphName,
} from '../../../src';
import {
  federateSubgraphsFailure,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphFailure,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import {
  baseDirectiveDefinitionsWithSemanticNonNull,
  schemaQueryDefinition,
  semanticNonNullDefinition,
  versionOneRouterDefinitionsWithSemanticNonNull,
} from '../utils/utils';

describe('@semanticNonNull tests', () => {
  describe('normalization tests', () => {
    test('that an error is returned if levels is provided a value that is non-null', () => {
      const { errors } = normalizeSubgraphFailure(naa, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(SEMANTIC_NON_NULL, 'Query.a', '1st', [
          semanticNonNullLevelsNonNullErrorMessage({
            typeString: `[[ID]!]`,
            value: '1',
          }),
        ]),
      );
    });

    test('that an error is returned if levels is provided multiple values that are non-null', () => {
      const { errors } = normalizeSubgraphFailure(nab, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(SEMANTIC_NON_NULL, 'Query.a', '1st', [
          semanticNonNullLevelsNonNullErrorMessage({
            typeString: `[[ID!]]!`,
            value: '0',
          }),
          semanticNonNullLevelsNonNullErrorMessage({
            typeString: `[[ID!]]!`,
            value: '2',
          }),
        ]),
      );
    });

    test('that an error is returned if levels is provided an out-of-bounds value', () => {
      const { errors } = normalizeSubgraphFailure(nac, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(SEMANTIC_NON_NULL, 'Query.a', '1st', [
          semanticNonNullLevelsIndexOutOfBoundsErrorMessage({
            maxIndex: 2,
            typeString: `[[ID]]`,
            value: '3',
          }),
        ]),
      );
    });

    test('that an error is returned if levels is provided a negative value', () => {
      const { errors } = normalizeSubgraphFailure(nad, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(SEMANTIC_NON_NULL, 'Query.a', '1st', [
          semanticNonNullLevelsIndexOutOfBoundsErrorMessage({
            maxIndex: 0,
            typeString: ID_SCALAR,
            value: '-1',
          }),
        ]),
      );
    });

    test('that an error is returned if no levels are provided but the type is non-null', () => {
      const { errors } = normalizeSubgraphFailure(nae, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        invalidDirectiveError(SEMANTIC_NON_NULL, 'Query.a', '1st', [
          semanticNonNullLevelsNonNullErrorMessage({
            typeString: `ID!`,
            value: '0',
          }),
        ]),
      );
    });

    test('that @semanticNonNull is validated successfully', () => {
      const { schema } = normalizeSubgraphSuccess(naf, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            baseDirectiveDefinitionsWithSemanticNonNull +
            `
          type Query {
            a: ID @semanticNonNull
          }
          
          scalar openfed__FieldSet
        `,
        ),
      );
    });
  });

  describe('federation tests', () => {
    test('that the directive is persisted in the federated schema #1', () => {
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [faaa],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitionsWithSemanticNonNull +
            `
            type Query {
              a: ID @semanticNonNull(levels: [0])
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            semanticNonNullDefinition +
            `
            type Query {
              a: ID @semanticNonNull(levels: [0])
            }
          `,
        ),
      );
    });

    test('that the directive is persisted in the federated schema #2', () => {
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [faaa, faab],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitionsWithSemanticNonNull +
            `
            type Query {
              a: ID @semanticNonNull(levels: [0])
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            semanticNonNullDefinition +
            `
            type Query {
              a: ID @semanticNonNull(levels: [0])
            }
          `,
        ),
      );
    });

    test('that the directive is persisted in the federated schema #3', () => {
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [faab, faaa],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitionsWithSemanticNonNull +
            `
            type Query {
              a: ID @semanticNonNull(levels: [0])
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            semanticNonNullDefinition +
            `
            type Query {
              a: ID @semanticNonNull(levels: [0])
            }
          `,
        ),
      );
    });

    test('that a level is persisted in the federated schema', () => {
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [fbaa],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitionsWithSemanticNonNull +
            `
            type Query {
              a: [ID] @semanticNonNull(levels: [1])
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            semanticNonNullDefinition +
            `
            type Query {
              a: [ID] @semanticNonNull(levels: [1])
            }
          `,
        ),
      );
    });

    test('that multiple levels are persisted in the federated schema', () => {
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [fcaa],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitionsWithSemanticNonNull +
            `
            type Query {
              a: [ID] @semanticNonNull(levels: [0, 1])
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            semanticNonNullDefinition +
            `
            type Query {
              a: [ID] @semanticNonNull(levels: [0, 1])
            }
          `,
        ),
      );
    });

    test('that a non-null wrapper unspecified by levels is ignored', () => {
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [fdaa],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitionsWithSemanticNonNull +
            `
            type Query {
              a: [ID]! @semanticNonNull(levels: [1])
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            semanticNonNullDefinition +
            `
            type Query {
              a: [ID]! @semanticNonNull(levels: [1])
            }
          `,
        ),
      );
    });

    test('that multiple non-null wrappers unspecified by levels are ignored', () => {
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [feaa],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitionsWithSemanticNonNull +
            `
            type Query {
              a: [[[ID]!]!] @semanticNonNull(levels: [0, 3])
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            semanticNonNullDefinition +
            `
            type Query {
              a: [[[ID]!]!] @semanticNonNull(levels: [0, 3])
            }
          `,
        ),
      );
    });

    test('that undefined levels and [0] are treated equal #1', () => {
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [faaa, ffaa],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitionsWithSemanticNonNull +
            `
            type Query {
              a: ID @semanticNonNull(levels: [0])
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            semanticNonNullDefinition +
            `
            type Query {
               a: ID @semanticNonNull(levels: [0])
            }
          `,
        ),
      );
    });

    test('that undefined levels and [0] are treated equal #2', () => {
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [ffaa, faaa],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitionsWithSemanticNonNull +
            `
            type Query {
              a: ID @semanticNonNull(levels: [0])
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            semanticNonNullDefinition +
            `
            type Query {
               a: ID @semanticNonNull(levels: [0])
            }
          `,
        ),
      );
    });

    test('that an error is returned if levels are inconsistently defined', () => {
      const { errors } = federateSubgraphsFailure([fgaa, fgab, fgac], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toStrictEqual(
        semanticNonNullInconsistentLevelsError({
          name: 'a',
          nullLevelsBySubgraphName: new Map<SubgraphName, Set<number>>([
            [fgaa.name, new Set<number>([0, 2, 3])],
            [fgab.name, new Set<number>([0, 3])],
            [fgac.name, new Set<number>([2, 3])],
          ]),
          renamedParentTypeName: QUERY,
        } as FieldData),
      );
    });

    test('that differences in type are ignored as long as the levels are consistently defined', () => {
      const { federatedGraphClientSchema, federatedGraphSchema } = federateSubgraphsSuccess(
        [fhaa, fhab],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitionsWithSemanticNonNull +
            `
            type Query {
              a: [[[ID]]] @semanticNonNull(levels: [0, 2])
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            semanticNonNullDefinition +
            `
            type Query {
               a: [[[ID]]] @semanticNonNull(levels: [0, 2])
            }
          `,
        ),
      );
    });
  });
});

const naa: Subgraph = {
  name: 'naa',
  url: '',
  definitions: parse(`
    type Query {
      a: [[ID]!] @semanticNonNull(levels: [1])
    }
  `),
};

const nab: Subgraph = {
  name: 'nab',
  url: '',
  definitions: parse(`
    type Query {
      a: [[ID!]]! @semanticNonNull(levels: [0, 2])
    }
  `),
};

const nac: Subgraph = {
  name: 'nac',
  url: '',
  definitions: parse(`
    type Query {
      a: [[ID]] @semanticNonNull(levels: [3])
    }
  `),
};

const nad: Subgraph = {
  name: 'nad',
  url: '',
  definitions: parse(`
    type Query {
      a: ID @semanticNonNull(levels: [-1])
    }
  `),
};

const nae: Subgraph = {
  name: 'nae',
  url: '',
  definitions: parse(`
    type Query {
      a: ID! @semanticNonNull
    }
  `),
};

const naf: Subgraph = {
  name: 'naf',
  url: '',
  definitions: parse(`
    type Query {
      a: ID @semanticNonNull
    }
  `),
};

const faaa: Subgraph = {
  name: 'faaa',
  url: '',
  definitions: parse(`
    type Query {
      a: ID @semanticNonNull
    }
  `),
};

const faab: Subgraph = {
  name: 'faab',
  url: '',
  definitions: parse(`
    type Query {
      a: ID
    }
  `),
};

const fbaa: Subgraph = {
  name: 'fbaa',
  url: '',
  definitions: parse(`
    type Query {
      a: [ID] @semanticNonNull(levels: [1])
    }
  `),
};

const fcaa: Subgraph = {
  name: 'fcaa',
  url: '',
  definitions: parse(`
    type Query {
      a: [ID] @semanticNonNull(levels: [0, 1])
    }
  `),
};

const fdaa: Subgraph = {
  name: 'fdaa',
  url: '',
  definitions: parse(`
    type Query {
      a: [ID]! @semanticNonNull(levels: [1])
    }
  `),
};

const feaa: Subgraph = {
  name: 'feaa',
  url: '',
  definitions: parse(`
    type Query {
      a: [[[ID]!]!] @semanticNonNull(levels: [0, 3])
    }
  `),
};

const ffaa: Subgraph = {
  name: 'ffaa',
  url: '',
  definitions: parse(`
    type Query {
      a: ID @semanticNonNull(levels: [0])
    }
  `),
};

const fgaa: Subgraph = {
  name: 'fgaa',
  url: '',
  definitions: parse(`
    type Query {
      a: [[[ID]]!] @semanticNonNull(levels: [0, 2, 3])
    }
  `),
};

const fgab: Subgraph = {
  name: 'fgab',
  url: '',
  definitions: parse(`
    type Query {
      a: [[[ID]]!] @semanticNonNull(levels: [0, 3])
    }
  `),
};

const fgac: Subgraph = {
  name: 'fgac',
  url: '',
  definitions: parse(`
    type Query {
      a: [[[ID]]!] @semanticNonNull(levels: [2, 3])
    }
  `),
};

const fhaa: Subgraph = {
  name: 'fhaa',
  url: '',
  definitions: parse(`
    type Query {
      a: [[[ID]]] @semanticNonNull(levels: [0, 2])
    }
  `),
};

const fhab: Subgraph = {
  name: 'fhab',
  url: '',
  definitions: parse(`
    type Query {
      a: [[[ID!]]!] @semanticNonNull(levels: [0, 2])
    }
  `),
};
