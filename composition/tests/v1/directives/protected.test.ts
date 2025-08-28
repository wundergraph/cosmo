import { describe, expect, test } from 'vitest';
import {
  ConfigurationData,
  FieldName,
  QUERY,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
  TypeName,
} from '../../../src';
import { parse } from 'graphql';
import { federateSubgraphsSuccess, normalizeString, schemaToSortedNormalizedString } from '../../utils/utils';
import {
  baseDirectiveDefinitionsWithProtected,
  schemaQueryDefinition,
  versionOneRouterDefinitions,
} from '../utils/utils';

describe('@openfed__protected tests', () => {
  test('that @openfed__protected is propagated into the router configuration from the field level', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [naaa],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
        type Query {
          a: ID
        }
      `,
      ),
    );
    const { configurationDataByTypeName } = subgraphConfigBySubgraphName.get(naaa.name)!;
    expect(configurationDataByTypeName).toStrictEqual(
      new Map<TypeName, ConfigurationData>([
        [
          QUERY,
          {
            isRootNode: true,
            fieldNames: new Set<FieldName>(['a']),
            protectedFieldNames: ['a'],
            typeName: QUERY,
          },
        ],
      ]),
    );
  });

  test('that multiple @openfed__protected fields are propagated in the router configuration', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [nbaa],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
        type Query {
          a: ID
          b: ID
          c: ID
          d: ID
        }
      `,
      ),
    );
    const { configurationDataByTypeName } = subgraphConfigBySubgraphName.get(nbaa.name)!;
    expect(configurationDataByTypeName).toStrictEqual(
      new Map<TypeName, ConfigurationData>([
        [
          QUERY,
          {
            isRootNode: true,
            fieldNames: new Set<FieldName>(['a', 'b', 'c', 'd']),
            protectedFieldNames: ['a', 'd'],
            typeName: QUERY,
          },
        ],
      ]),
    );
  });

  test('that @openfed__protected is propagated into the router configuration from the Object level', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [ncaa],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
        type Query {
          a: ID
          b: ID
          c: ID
          d: ID
        }
      `,
      ),
    );
    const { configurationDataByTypeName } = subgraphConfigBySubgraphName.get(ncaa.name)!;
    expect(configurationDataByTypeName).toStrictEqual(
      new Map<TypeName, ConfigurationData>([
        [
          QUERY,
          {
            isRootNode: true,
            fieldNames: new Set<FieldName>(['a', 'b', 'c', 'd']),
            protectedFieldNames: ['a', 'b', 'c', 'd'],
            typeName: QUERY,
          },
        ],
      ]),
    );
  });

  test('that @openfed__protected propagation is scoped by Object, extension, and field #1', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [ndaa],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
        type Query {
          a: ID
          b: ID
          c: ID
          d: ID
        }
      `,
      ),
    );
    const { configurationDataByTypeName } = subgraphConfigBySubgraphName.get(ndaa.name)!;
    expect(configurationDataByTypeName).toStrictEqual(
      new Map<TypeName, ConfigurationData>([
        [
          QUERY,
          {
            isRootNode: true,
            fieldNames: new Set<FieldName>(['a', 'b', 'c', 'd']),
            protectedFieldNames: ['a'],
            typeName: QUERY,
          },
        ],
      ]),
    );
  });

  test('that @openfed__protected propagation is scoped by Object, extension, and field #2', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [neaa],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
        type Query {
          a: ID
          b: ID
          c: ID
          d: ID
        }
      `,
      ),
    );
    const { configurationDataByTypeName } = subgraphConfigBySubgraphName.get(neaa.name)!;
    expect(configurationDataByTypeName).toStrictEqual(
      new Map<TypeName, ConfigurationData>([
        [
          QUERY,
          {
            isRootNode: true,
            fieldNames: new Set<FieldName>(['a', 'b', 'c', 'd']),
            protectedFieldNames: ['a', 'd'],
            typeName: QUERY,
          },
        ],
      ]),
    );
  });

  test('that @openfed__protected propagation is scoped by Object, extension, and field #3', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [nfaa],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
        type Query {
          a: ID
          b: ID
          c: ID
          d: ID
        }
      `,
      ),
    );
    const { configurationDataByTypeName } = subgraphConfigBySubgraphName.get(nfaa.name)!;
    expect(configurationDataByTypeName).toStrictEqual(
      new Map<TypeName, ConfigurationData>([
        [
          QUERY,
          {
            isRootNode: true,
            fieldNames: new Set<FieldName>(['a', 'b', 'c', 'd']),
            protectedFieldNames: ['a', 'b', 'c'],
            typeName: QUERY,
          },
        ],
      ]),
    );
  });

  test('that @openfed__protected propagation is scoped by Object, extension, and field #4', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [ngaa],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
        type Query {
          a: ID
          b: ID
          c: ID
          d: ID
        }
      `,
      ),
    );
    const { configurationDataByTypeName } = subgraphConfigBySubgraphName.get(ngaa.name)!;
    expect(configurationDataByTypeName).toStrictEqual(
      new Map<TypeName, ConfigurationData>([
        [
          QUERY,
          {
            isRootNode: true,
            fieldNames: new Set<FieldName>(['a', 'b', 'c', 'd']),
            protectedFieldNames: ['a', 'b', 'c'],
            typeName: QUERY,
          },
        ],
      ]),
    );
  });

  test('that @openfed__protected is propagated in the router configuration by multiple subgraphs successfully', () => {
    const { federatedGraphSchema, subgraphConfigBySubgraphName } = federateSubgraphsSuccess(
      [nhaa, nhab],
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );
    expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
        type Query {
          a: ID
          b: ID
          c: ID
          d: ID
          e: ID
        }
      `,
      ),
    );
    const { schema: nhaaSchema, configurationDataByTypeName: nhaaConfig } = subgraphConfigBySubgraphName.get(
      nhaa.name,
    )!;
    expect(schemaToSortedNormalizedString(nhaaSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          baseDirectiveDefinitionsWithProtected +
          `
        type Query {
          a: ID
          b: ID @openfed__protected
          c: ID @openfed__protected
          d: ID @openfed__protected
        }
        
        scalar openfed__FieldSet
      `,
      ),
    );
    expect(nhaaConfig).toStrictEqual(
      new Map<TypeName, ConfigurationData>([
        [
          QUERY,
          {
            isRootNode: true,
            fieldNames: new Set<FieldName>(['a', 'b', 'c', 'd']),
            protectedFieldNames: ['b', 'c', 'd'],
            typeName: QUERY,
          },
        ],
      ]),
    );
    const { schema: nhabSchema, configurationDataByTypeName: nhabConfig } = subgraphConfigBySubgraphName.get(
      nhab.name,
    )!;
    expect(schemaToSortedNormalizedString(nhabSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          baseDirectiveDefinitionsWithProtected +
          `
        type Query {
          a: ID @openfed__protected
          b: ID @openfed__protected
          c: ID @openfed__protected
          d: ID @openfed__protected
          e: ID @openfed__protected
        }
        
        scalar openfed__FieldSet
      `,
      ),
    );
    expect(nhabConfig).toStrictEqual(
      new Map<TypeName, ConfigurationData>([
        [
          QUERY,
          {
            isRootNode: true,
            fieldNames: new Set<FieldName>(['a', 'b', 'c', 'd', 'e']),
            protectedFieldNames: ['a', 'b', 'c', 'd', 'e'],
            typeName: QUERY,
          },
        ],
      ]),
    );
  });
});

const naaa: Subgraph = {
  name: 'naaa',
  url: '',
  definitions: parse(`
    type Query {
      a: ID @openfed__protected
    }
  `),
};

const nbaa: Subgraph = {
  name: 'nbaa',
  url: '',
  definitions: parse(`
    type Query {
      a: ID @openfed__protected
      b: ID
      c: ID
      d: ID @openfed__protected
    }
  `),
};

const ncaa: Subgraph = {
  name: 'ncaa',
  url: '',
  definitions: parse(`
    type Query @openfed__protected {
      a: ID
      b: ID
      c: ID
      d: ID
    }
  `),
};

const ndaa: Subgraph = {
  name: 'ndaa',
  url: '',
  definitions: parse(`
    type Query @openfed__protected {
      a: ID
    }
    
    extend type Query {
      b: ID
      c: ID
      d: ID
    }
  `),
};

const neaa: Subgraph = {
  name: 'neaa',
  url: '',
  definitions: parse(`
    type Query @openfed__protected {
      a: ID
    }
    
    extend type Query {
      b: ID
      c: ID
      d: ID @openfed__protected
    }
  `),
};

const nfaa: Subgraph = {
  name: 'nfaa',
  url: '',
  definitions: parse(`
    type Query @openfed__protected {
      a: ID
    }
    
    extend type Query @openfed__protected {
      b: ID
      c: ID
    }
    
    extend type Query {
      d: ID
    }
  `),
};

const ngaa: Subgraph = {
  name: 'ngaa',
  url: '',
  definitions: parse(`
    type Query @openfed__protected {
      a: ID
    }
    
    extend type Query @openfed__protected {
      b: ID
      c: ID @openfed__protected
    }
    
    extend type Query {
      d: ID
    }
  `),
};

const nhaa: Subgraph = {
  name: 'nhaa',
  url: '',
  definitions: parse(`
    type Query {
      a: ID
    }
    
    extend type Query @openfed__protected {
      b: ID
      c: ID
    }
    
    extend type Query {
      d: ID @openfed__protected
    }
  `),
};

const nhab: Subgraph = {
  name: 'nhab',
  url: '',
  definitions: parse(`
    type Query {
      a: ID @openfed__protected
    }
    
    extend type Query {
      b: ID @openfed__protected
      c: ID @openfed__protected
    }
    
    extend type Query @openfed__protected {
      d: ID @openfed__protected
      e: ID
    }
  `),
};
