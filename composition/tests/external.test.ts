import { describe, expect, test } from 'vitest';
import { federateSubgraphs, Subgraph } from '../src';
import { parse } from 'graphql';
import {
  normalizeString,
  schemaToSortedNormalizedString,
  versionTwoSchemaQueryAndPersistedDirectiveDefinitions,
} from './utils/utils';

describe('External tests', () => {
  test('that @external does not contribute to shareability checks #1.1', () => {
    const { errors, federationResult} = federateSubgraphs([subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(versionTwoSchemaQueryAndPersistedDirectiveDefinitions + `
      type Entity implements Interface {
        age: Int!
        id: ID!
        isEntity: Boolean!
        name: String!
      }
      
      type EntityTwo implements Interface {
        age: Int!
        field: String!
        id: ID!
        name: String!
      }
      
      interface Interface {
        id: ID!
        name: String!
      }
      
      type Query {
        entity: Entity!
        entityTwo: EntityTwo!
      }
      
      scalar openfed__Scope
    `));
  });

  test('that @external does not contribute to shareability checks #1.2', () => {
    const { errors, federationResult} = federateSubgraphs([subgraphB, subgraphA]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(versionTwoSchemaQueryAndPersistedDirectiveDefinitions + `
      type Entity implements Interface {
        age: Int!
        id: ID!
        isEntity: Boolean!
        name: String!
      }
      
      type EntityTwo implements Interface {
        age: Int!
        field: String!
        id: ID!
        name: String!
      }
      
      interface Interface {
        id: ID!
        name: String!
      }
      
      type Query {
        entity: Entity!
        entityTwo: EntityTwo!
      }
      
      scalar openfed__Scope
    `));
  });

  test('that @external does not contribute to shareability checks #2.1', () => {
    const { errors, federationResult} = federateSubgraphs([subgraphA, subgraphB, subgraphC]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(versionTwoSchemaQueryAndPersistedDirectiveDefinitions + `
      type Entity implements Interface {
        age: Int!
        field: String!
        id: ID!
        isEntity: Boolean!
        name: String!
      }
      
      type EntityTwo implements Interface {
        age: Int!
        field: String!
        id: ID!
        isEntity: Boolean!
        name: String!
      }
      
      interface Interface {
        id: ID!
        name: String!
      }
      
      type Query {
        entity: Entity!
        entityTwo: EntityTwo!
      }
      
      scalar openfed__Scope
    `));
  });

  test('that @external does not contribute to shareability checks #2.2', () => {
    const { errors, federationResult} = federateSubgraphs([subgraphA, subgraphC, subgraphB]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(versionTwoSchemaQueryAndPersistedDirectiveDefinitions + `
      type Entity implements Interface {
        age: Int!
        field: String!
        id: ID!
        isEntity: Boolean!
        name: String!
      }
      
      type EntityTwo implements Interface {
        age: Int!
        field: String!
        id: ID!
        isEntity: Boolean!
        name: String!
      }
      
      interface Interface {
        id: ID!
        name: String!
      }
      
      type Query {
        entity: Entity!
        entityTwo: EntityTwo!
      }
      
      scalar openfed__Scope
    `));
  });

  test('that @external does not contribute to shareability checks #2.3', () => {
    const { errors, federationResult} = federateSubgraphs([subgraphB, subgraphA, subgraphC]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(versionTwoSchemaQueryAndPersistedDirectiveDefinitions + `
      type Entity implements Interface {
        age: Int!
        field: String!
        id: ID!
        isEntity: Boolean!
        name: String!
      }
      
      type EntityTwo implements Interface {
        age: Int!
        field: String!
        id: ID!
        isEntity: Boolean!
        name: String!
      }
      
      interface Interface {
        id: ID!
        name: String!
      }
      
      type Query {
        entity: Entity!
        entityTwo: EntityTwo!
      }
      
      scalar openfed__Scope
    `));
  });

  test('that @external does not contribute to shareability checks #2.4', () => {
    const { errors, federationResult} = federateSubgraphs([subgraphB, subgraphC, subgraphA]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(versionTwoSchemaQueryAndPersistedDirectiveDefinitions + `
      type Entity implements Interface {
        age: Int!
        field: String!
        id: ID!
        isEntity: Boolean!
        name: String!
      }
      
      type EntityTwo implements Interface {
        age: Int!
        field: String!
        id: ID!
        isEntity: Boolean!
        name: String!
      }
      
      interface Interface {
        id: ID!
        name: String!
      }
      
      type Query {
        entity: Entity!
        entityTwo: EntityTwo!
      }
      
      scalar openfed__Scope
    `));
  });

  test('that @external does not contribute to shareability checks #2.5', () => {
    const { errors, federationResult} = federateSubgraphs([subgraphC, subgraphA, subgraphB]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(versionTwoSchemaQueryAndPersistedDirectiveDefinitions + `
      type Entity implements Interface {
        age: Int!
        field: String!
        id: ID!
        isEntity: Boolean!
        name: String!
      }
      
      type EntityTwo implements Interface {
        age: Int!
        field: String!
        id: ID!
        isEntity: Boolean!
        name: String!
      }
      
      interface Interface {
        id: ID!
        name: String!
      }
      
      type Query {
        entity: Entity!
        entityTwo: EntityTwo!
      }
      
      scalar openfed__Scope
    `));
  });

  test('that @external does not contribute to shareability checks #2.6', () => {
    const { errors, federationResult} = federateSubgraphs([subgraphC, subgraphB, subgraphA]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(versionTwoSchemaQueryAndPersistedDirectiveDefinitions + `
      type Entity implements Interface {
        age: Int!
        field: String!
        id: ID!
        isEntity: Boolean!
        name: String!
      }
      
      type EntityTwo implements Interface {
        age: Int!
        field: String!
        id: ID!
        isEntity: Boolean!
        name: String!
      }
      
      interface Interface {
        id: ID!
        name: String!
      }
      
      type Query {
        entity: Entity!
        entityTwo: EntityTwo!
      }
      
      scalar openfed__Scope
    `));
  });
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      entity: Entity!
      entityTwo: EntityTwo!
    }
    
    interface Interface {
      id: ID!
      name: String!
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      name: String! @external
      isEntity: Boolean!
    }
    
    type EntityTwo implements Interface @key(fields: "id") {
      id: ID!
      name: String!
      age: Int!
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    interface Interface {
      id: ID!
      name: String!
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      name: String!
      age: Int!
    }
    
    type EntityTwo implements Interface @key(fields: "id") {
      id: ID!
      name: String! @external @shareable
      field: String!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    interface Interface {
      id: ID!
      name: String!
    }
    
    type Entity implements Interface @key(fields: "id") {
      id: ID!
      name: String! @external
      field: String!
    }
    
    type EntityTwo implements Interface @key(fields: "id") {
      id: ID!
      name: String! @external
      isEntity: Boolean!
    }
  `),
};