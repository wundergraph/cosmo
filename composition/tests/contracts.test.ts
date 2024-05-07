import { federateSubgraphs, federateSubgraphsWithContracts, Subgraph } from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  normalizeString,
  schemaQueryDefinition,
  schemaToSortedNormalizedString,
  versionOneRouterContractDefinitions,
  versionOneRouterDefinitions,
} from './utils/utils';

describe('Contract tests', () => {
  const tagsToExcludeByContractName = new Map<string, Set<string>>([
    ['one', new Set<string>(['excludeMe'])],
    ['two', new Set<string>(['excludeMeTwo'])],
  ]);

  test('that objects are removed by tag', () => {
    const { federationResultContainerByContractName } = federateSubgraphsWithContracts(
      [subgraphOne, subgraphA],
      tagsToExcludeByContractName,
    );
    expect(federationResultContainerByContractName).toBeDefined();
    const contractOne = federationResultContainerByContractName!.get('one');
    expect(contractOne).toBeDefined();
    expect(contractOne!.errors).toBeUndefined();
    expect(contractOne!.federationResult).toBeDefined();
    const contractTwo = federationResultContainerByContractName!.get('two');
    expect(contractTwo).toBeDefined();
    expect(contractTwo!.errors).toBeUndefined();
    expect(contractTwo!.federationResult).toBeDefined();
    expect(schemaToSortedNormalizedString(contractOne!.federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterContractDefinitions +
          `
      type Object @tag(name: "excludeMe") @inaccessible {
        name: String!
      }
      
      type ObjectTwo @tag(name: "excludeMeTwo") {
        name: String!
      }

      type Query {
        dummy: String!
      }
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(contractOne!.federationResult!.federatedGraphClientSchema!)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type ObjectTwo {
        name: String!
      }

      type Query {
        dummy: String!
      }
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(contractTwo!.federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterContractDefinitions +
          `
      type Object @tag(name: "excludeMe") {
        name: String!
      }

      type ObjectTwo @tag(name: "excludeMeTwo") @inaccessible {
        name: String!
      }

      type Query {
        dummy: String!
      }
    `,
      ),
    );
    expect(schemaToSortedNormalizedString(contractTwo!.federationResult!.federatedGraphClientSchema!)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
        name: String!
      }

      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on an object #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphC]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Object @tag(name: "one") {
        age: Int!
        name: String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
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

  test('that a client schema is produced if a @tag directive is defined on an object #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphC, subgraphB]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Object @tag(name: "one") {
        age: Int!
        name: String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
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

  test('that a client schema is produced if a @tag directive is defined on a object field #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphD]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Object {
        age: Int!
        name: String! @tag(name: "one")
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
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

  test('that a client schema is produced if a @tag directive is defined on a object field #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphD, subgraphB]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Object {
        age: Int!
        name: String! @tag(name: "one")
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
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

  test('that a client schema is produced if a @tag directive is defined on a object field argument #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphB, subgraphE]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Object {
        age: Int!
        name(arg: String! @tag(name: "one")): String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
        age: Int!
        name(arg: String!): String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a object field argument #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphE, subgraphB]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Object {
        age: Int!
        name(arg: String! @tag(name: "one")): String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
        age: Int!
        name(arg: String!): String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a shared object field #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphU, subgraphD]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Object {
        name: String! @tag(name: "one")
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a shared object field #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphD, subgraphU]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Object {
        name: String! @tag(name: "one")
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a shared object field argument #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphV, subgraphE]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Object {
        name(arg: String! @tag(name: "one")): String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
        name(arg: String!): String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a shared object field argument #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphE, subgraphV]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Object {
        name(arg: String! @tag(name: "one")): String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Object {
        name(arg: String!): String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on an object extension #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphG, subgraphF]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Entity @tag(name: "one") {
        age: Int!
        id: ID!
        name: String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Entity {
        age: Int!
        id: ID!
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on an object extension #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphF, subgraphG]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Entity @tag(name: "one") {
        age: Int!
        id: ID!
        name: String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Entity {
        age: Int!
        id: ID!
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on an object extension field #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphH, subgraphF]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Entity {
        age: Int!
        id: ID!
        name: String! @tag(name: "one")
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Entity {
        age: Int!
        id: ID!
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on an object extension field #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphF, subgraphH]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Entity {
        age: Int!
        id: ID!
        name: String! @tag(name: "one")
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Entity {
        age: Int!
        id: ID!
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on an object extension field argument #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphF, subgraphI]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Entity {
        age: Int!
        id: ID!
        name(arg: String! @tag(name: "one")): String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Entity {
        age: Int!
        id: ID!
        name(arg: String!): String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on an object extension field argument #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphF, subgraphI]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Entity {
        age: Int!
        id: ID!
        name(arg: String! @tag(name: "one")): String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Entity {
        age: Int!
        id: ID!
        name(arg: String!): String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a shared object extension field #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphW, subgraphH]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Entity {
        id: ID!
        name: String! @tag(name: "one")
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Entity {
        id: ID!
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a shared object extension field #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphH, subgraphW]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Entity {
        id: ID!
        name: String! @tag(name: "one")
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Entity {
        id: ID!
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a shared object extension field argument #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphX, subgraphI]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Entity {
        id: ID!
        name(arg: String! @tag(name: "one")): String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Entity {
        id: ID!
        name(arg: String!): String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a shared object extension field argument #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphI, subgraphX]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Entity {
        id: ID!
        name(arg: String! @tag(name: "one")): String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Entity {
        id: ID!
        name(arg: String!): String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on an interface #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphJ, subgraphK]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      interface Interface @tag(name: "one") {
        age: Int!
        name: String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
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

  test('that a client schema is produced if a @tag directive is defined on an interface #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphK, subgraphJ]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      interface Interface @tag(name: "one") {
        age: Int!
        name: String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
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

  test('that a client schema is produced if a @tag directive is defined on a interface field #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphJ, subgraphL]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      interface Interface {
        age: Int!
        name: String! @tag(name: "one")
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
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

  test('that a client schema is produced if a @tag directive is defined on a interface field #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphL, subgraphJ]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      interface Interface {
        age: Int!
        name: String! @tag(name: "one")
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
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

  test('that a client schema is produced if a @tag directive is defined on a interface field argument #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphJ, subgraphM]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      interface Interface {
        age: Int!
        name(arg: String! @tag(name: "one")): String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      interface Interface {
        age: Int!
        name(arg: String!): String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a interface field argument #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphM, subgraphJ]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      interface Interface {
        age: Int!
        name(arg: String! @tag(name: "one")): String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      interface Interface {
        age: Int!
        name(arg: String!): String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a shared interface field #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphY, subgraphL]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      interface Interface {
        name: String! @tag(name: "one")
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      interface Interface {
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a shared interface field #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphL, subgraphY]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      interface Interface {
        name: String! @tag(name: "one")
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      interface Interface {
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a shared interface field argument #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphZ, subgraphM]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      interface Interface {
        name(arg: String! @tag(name: "one")): String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      interface Interface {
        name(arg: String!): String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a shared interface field argument #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphM, subgraphZ]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      interface Interface {
        name(arg: String! @tag(name: "one")): String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      interface Interface {
        name(arg: String!): String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on an input object #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphN, subgraphO]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      input Input @tag(name: "one") {
        name: String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      input Input {
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on an input object #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphO, subgraphN]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      input Input @tag(name: "one") {
        name: String!
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      input Input {
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on an input object field #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphN, subgraphP]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      input Input {
        name: String! @tag(name: "one")
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      input Input {
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on an input object field #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphP, subgraphN]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      input Input {
        name: String! @tag(name: "one")
      }
      
      type Query {
        dummy: String!
      }`,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      input Input {
        name: String!
      }
      
      type Query {
        dummy: String!
      }
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a scalar #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphQ, subgraphR]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Query {
        dummy: String!
      }
      
      scalar Scalar @tag(name: "one")
      `,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Query {
        dummy: String!
      }
      
      scalar Scalar
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a scalar #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphR, subgraphQ]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
      type Query {
        dummy: String!
      }
      
      scalar Scalar @tag(name: "one")
      `,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
      type Query {
        dummy: String!
      }
      
      scalar Scalar
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a union #1.1', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphS, subgraphT]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
    type Entity {
      age: Int!
      id: ID!
      name: String!
    }

    type Query {
      dummy: String!
    }
    
    union Union @tag(name: "one") = Entity
      `,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
    type Entity {
      age: Int!
      id: ID!
      name: String!
    }

    type Query {
      dummy: String!
    }
    
    union Union = Entity
    `,
      ),
    );
  });

  test('that a client schema is produced if a @tag directive is defined on a union #1.2', () => {
    const { errors, federationResult } = federateSubgraphs([subgraphT, subgraphS]);
    expect(errors).toBeUndefined();
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
      normalizeString(
        versionOneRouterDefinitions +
          `
    type Entity {
      age: Int!
      id: ID!
      name: String!
    }

    type Query {
      dummy: String!
    }
    
    union Union @tag(name: "one") = Entity
      `,
      ),
    );
    expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
      normalizeString(
        schemaQueryDefinition +
          `
    type Entity {
      age: Int!
      id: ID!
      name: String!
    }

    type Query {
      dummy: String!
    }
    
    union Union = Entity
    `,
      ),
    );
  });
});

const subgraphOne: Subgraph = {
  name: 'subgraph-one',
  url: '',
  definitions: parse(`
    type Object @tag(name: "excludeMe") {
      name: String!
    }
    
    type ObjectTwo @tag(name: "excludeMeTwo") {
      name: String!
    }
  `),
};

const subgraphA: Subgraph = {
  name: 'subgraph-a',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
  `),
};

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Object {
      age: Int!
    }
    
    type Query {
      dummy: String!
    }
  `),
};

const subgraphC: Subgraph = {
  name: 'subgraph-c',
  url: '',
  definitions: parse(`
    type Object @tag(name: "one") {
      name: String!
    }
  `),
};

const subgraphD: Subgraph = {
  name: 'subgraph-d',
  url: '',
  definitions: parse(`
    type Object {
      name: String! @tag(name: "one")
    }
  `),
};

const subgraphE: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Object {
      name(arg: String! @tag(name: "one")): String!
    }
  `),
};

const subgraphF: Subgraph = {
  name: 'subgraph-f',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      age: Int!
    }
        
    type Query {
      dummy: String!
    }
  `),
};

const subgraphG: Subgraph = {
  name: 'subgraph-g',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id") @tag(name: "one") {
      id: ID!
      name: String!
    }
  `),
};

const subgraphH: Subgraph = {
  name: 'subgraph-h',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id") {
      id: ID!
      name: String! @tag(name: "one")
    }
  `),
};

const subgraphI: Subgraph = {
  name: 'subgraph-i',
  url: '',
  definitions: parse(`
    extend type Entity @key(fields: "id") {
      id: ID!
      name(arg: String! @tag(name: "one")): String!
    }
  `),
};

const subgraphJ: Subgraph = {
  name: 'subgraph-j',
  url: '',
  definitions: parse(`
    interface Interface {
      age: Int!
    }
    
    type Query {
      dummy: String!
    }
  `),
};

const subgraphK: Subgraph = {
  name: 'subgraph-k',
  url: '',
  definitions: parse(`
    interface Interface @tag(name: "one") {
      name: String!
    }
  `),
};

const subgraphL: Subgraph = {
  name: 'subgraph-l',
  url: '',
  definitions: parse(`
    interface Interface {
      name: String! @tag(name: "one")
    }
  `),
};

const subgraphM: Subgraph = {
  name: 'subgraph-m',
  url: '',
  definitions: parse(`
    interface Interface {
      name(arg: String! @tag(name: "one")): String!
    }
  `),
};

const subgraphN: Subgraph = {
  name: 'subgraph-n',
  url: '',
  definitions: parse(`
    input Input {
      name: String!
    }

    type Query {
      dummy: String!
    }
  `),
};

const subgraphO: Subgraph = {
  name: 'subgraph-o',
  url: '',
  definitions: parse(`
    input Input @tag(name: "one") {
      name: String!
    }
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    input Input {
      name: String! @tag(name: "one")
    }
  `),
};

const subgraphQ: Subgraph = {
  name: 'subgraph-q',
  url: '',
  definitions: parse(`
    scalar Scalar

    type Query {
      dummy: String!
    }
  `),
};

const subgraphR: Subgraph = {
  name: 'subgraph-r',
  url: '',
  definitions: parse(`
    scalar Scalar @tag(name: "one")
  `),
};

const subgraphS: Subgraph = {
  name: 'subgraph-s',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String!
    }

    type Query {
      dummy: String!
    }
    
    union Union = Entity
  `),
};

const subgraphT: Subgraph = {
  name: 'subgraph-T',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      age: Int!
    }
    
    union Union @tag(name: "one") = Entity
  `),
};

const subgraphU: Subgraph = {
  name: 'subgraph-u',
  url: '',
  definitions: parse(`
    type Object {
      name: String!
    }
    
    type Query {
      dummy: String!
    }
  `),
};

const subgraphV: Subgraph = {
  name: 'subgraph-v',
  url: '',
  definitions: parse(`
    type Object {
      name(arg: String! @tag(name: "one")): String!
    }
    
    type Query {
      dummy: String!
    }
  `),
};

const subgraphW: Subgraph = {
  name: 'subgraph-w',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name: String!
    }
        
    type Query {
      dummy: String!
    }
  `),
};

const subgraphX: Subgraph = {
  name: 'subgraph-x',
  url: '',
  definitions: parse(`
    type Entity @key(fields: "id") {
      id: ID!
      name(arg: String!): String!
    }
    
    type Query {
      dummy: String!
    }
  `),
};

const subgraphY: Subgraph = {
  name: 'subgraph-Y',
  url: '',
  definitions: parse(`
    interface Interface {
      name: String!
    }
    
    type Query {
      dummy: String!
    }
  `),
};

const subgraphZ: Subgraph = {
  name: 'subgraph-z',
  url: '',
  definitions: parse(`
    interface Interface {
      name(arg: String!): String!
    }
    
    type Query {
      dummy: String!
    }
  `),
};
