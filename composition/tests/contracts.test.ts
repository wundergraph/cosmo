import {
  ContractTagOptions,
  federateSubgraphs,
  federateSubgraphsContract,
  federateSubgraphsWithContracts,
  parse,
  Subgraph,
} from '../src';
import { describe, expect, test } from 'vitest';
import {
  normalizeString,
  schemaQueryDefinition,
  schemaToSortedNormalizedString,
  versionOneRouterContractDefinitions,
  versionOneRouterDefinitions,
} from './utils/utils';

describe('Contract tests', () => {
  describe('Exclude tags', () => {
    const excludedTagsOne = {
      excludedTagNames: new Set<string>(['one', 'includeMe']),
      includedTagNames: new Set<string>(),
    };

    const excludedTagsTwo = {
      excludedTagNames: new Set<string>(['one']),
      includedTagNames: new Set<string>(),
    };

    test('that Objects are removed by tag', () => {
      const { federationResultContainerByContractName } = federateSubgraphsWithContracts(
        [subgraphOne, subgraphA],
        new Map<string, ContractTagOptions>([
          ['one', excludedTagsOne],
          [
            'two',
            {
              excludedTagNames: new Set<string>(['two', 'includeMe']),
              includedTagNames: new Set<string>(),
            },
          ],
        ]),
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
            type Object @tag(name: "one") @inaccessible {
              name: String!
            }

            type ObjectTwo @tag(name: "two") {
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
            type Object @tag(name: "one") {
              name: String!
            }

            type ObjectTwo @tag(name: "two") @inaccessible {
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

    test('that Object Fields are removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphB, subgraphD], excludedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Object {
              age: Int!
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that an Object is removed if its only Field is removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphA, subgraphD], excludedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that Interfaces are removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphJ, subgraphK], excludedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that Interface Fields are removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphJ, subgraphL], excludedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            interface Interface {
              age: Int!
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that an Interface is removed if its only Field is removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphA, subgraphL], excludedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that if an Interface is removed by tag, it is removed from its implementations', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphA, subgraphAE], excludedTagsTwo);
      expect(errors).toBeUndefined();
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

    test('that Input Objects are removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphN, subgraphO], excludedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that nullable Input Object fields are removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphAA, subgraphAK], excludedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            input Input {
              name: String
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that an Input Object is removed if its only Field is removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphA, subgraphP], excludedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that an Argument can be removed by tag #1.1', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphA, subgraphAF], excludedTagsTwo);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Object {
              field: String!
            }
            
            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that an Argument can be removed by tag #1.2', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphA, subgraphAG], excludedTagsTwo);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Object {
              field: String!
            }
            
            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that an Argument can be removed by tag #1.3', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphA, subgraphAH], excludedTagsTwo);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that a Scalar is removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphQ, subgraphR], excludedTagsTwo);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that a Union is removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphS, subgraphT], excludedTagsTwo);
      expect(errors).toBeUndefined();
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

    // TODO
    test.skip('that a Union is removed if all its members are removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphS, subgraphG], excludedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that an Enum is removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphAB, subgraphAC], excludedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that an Enum value is removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphAB, subgraphAD], excludedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            enum Enum {
              ONE
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that an Enum is removed if its only Value is removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphA, subgraphAD], excludedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that a nested Field can be removed by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphA, subgraphAI], excludedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });
  });

  describe('Include tags', () => {
    const includedTagsOne = {
      excludedTagNames: new Set<string>(),
      includedTagNames: new Set<string>(['one', 'includeMe']),
    };

    const includedTagsTwo = {
      excludedTagNames: new Set<string>(),
      includedTagNames: new Set<string>(['two', 'includeMe']),
    };

    const includedTagsThree = {
      excludedTagNames: new Set<string>(),
      includedTagNames: new Set<string>(['includeMe']),
    };

    test('that Objects are included by tag', () => {
      const { federationResultContainerByContractName } = federateSubgraphsWithContracts(
        [subgraphOne, subgraphInclude],
        new Map<string, ContractTagOptions>([
          ['one', includedTagsOne],
          ['two', includedTagsTwo],
        ]),
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
            type Object @tag(name: "one") {
              name: String!
            }

            type ObjectTwo @tag(name: "two") @inaccessible {
              name: String!
            }

            type Query {
              dummy: String! @inaccessible
              include: Int! @tag(name: "includeMe")
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(contractOne!.federationResult!.federatedGraphClientSchema!)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Object {
              name: String!
            }

            type Query {
              include: Int!
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(contractTwo!.federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterContractDefinitions +
            `
            type Object @tag(name: "one") @inaccessible {
              name: String!
            }

            type ObjectTwo @tag(name: "two") {
              name: String!
            }

            type Query {
              dummy: String! @inaccessible
              include: Int! @tag(name: "includeMe")
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(contractTwo!.federationResult!.federatedGraphClientSchema!)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type ObjectTwo {
              name: String!
            }

            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that Object Fields are included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract(
        [subgraphB, subgraphD, subgraphInclude],
        includedTagsOne,
      );
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Object {
              name: String!
            }

            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that an Object is removed if its only Field is not included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphInclude, subgraphD], includedTagsTwo);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that Interfaces are included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract(
        [subgraphJ, subgraphK, subgraphInclude],
        includedTagsOne,
      );
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            interface Interface {
              age: Int!
              name: String!
            }
            
            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that Interface Fields are removed if not included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract(
        [subgraphJ, subgraphL, subgraphInclude],
        includedTagsOne,
      );
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            interface Interface {
              name: String!
            }

            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that an Interface is removed if its only Field is not included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphInclude, subgraphL], includedTagsTwo);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that if an Interface is not included by tag, it is removed from its implementations', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphInclude, subgraphAE], includedTagsTwo);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Object {
              name: String!
            }

            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that Input Objects are included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract(
        [subgraphN, subgraphO, subgraphInclude],
        includedTagsOne,
      );
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            input Input {
              name: String
            }
            
            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that nullable Input Object Fields are removed if not included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract(
        [subgraphAA, subgraphAK, subgraphInclude],
        includedTagsOne,
      );
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            input Input {
              age: Int
            }

            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that an Input Object is removed if its only Field is not included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphInclude, subgraphP], includedTagsThree);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that an Argument can be included by tag #1.1', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphInclude, subgraphAF], includedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            input Input {
              name: String
            }
            
            type Object {
              field(input: Input): String!
            }
            
            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that an Argument can be included by tag #1.2', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphInclude, subgraphAG], includedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            input Input {
              name: String
            }

            type Object {
              field(input: [Input]): String!
            }

            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that an Argument can be included by tag #1.3', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphInclude, subgraphAH], includedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            input Input {
              name: String
            }

            type Object {
              field(input: [Input] = []): String!
            }

            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that an Argument can be included by tag #1.4', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphInclude, subgraphAJ], includedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            input Input {
              name: String
            }

            type Query {
              field(input: [Input] = []): String!
              include: Int!
            }
          `,
        ),
      );
    });

    test('that a Scalar is included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract(
        [subgraphInclude, subgraphQ, subgraphR],
        includedTagsOne,
      );
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              include: Int!
            }
            
            scalar Scalar
          `,
        ),
      );
    });

    test('that a Union is included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract(
        [subgraphInclude, subgraphS, subgraphT],
        includedTagsOne,
      );
      expect(errors).toBeUndefined();
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
              include: Int!
            }
            
            union Union = Entity
          `,
        ),
      );
    });

    // TODO
    test.skip('that a Union is removed if none of its members are included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract(
        [subgraphInclude, subgraphS, subgraphG],
        includedTagsOne,
      );
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that an Enum is included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract(
        [subgraphInclude, subgraphAB, subgraphAC],
        includedTagsOne,
      );
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            enum Enum {
              ONE
              TWO
            }
            
            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that an Enum Value is included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract(
        [subgraphInclude, subgraphAB, subgraphAD],
        includedTagsOne,
      );
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            enum Enum {
              TWO
            }

            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that an Enum is removed if its only value is not included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphInclude, subgraphAD], includedTagsThree);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Query {
              include: Int!
            }
          `,
        ),
      );
    });

    test('that a nested Field can be included by tag', () => {
      const { errors, federationResult } = federateSubgraphsContract([subgraphInclude, subgraphAI], includedTagsOne);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            enum Enum {
              A
            }
            
            type NestedObjectOne {
              nested: NestedObjectTwo!
            }
            
            type NestedObjectTwo {
              enum: Enum!
            }
            
            type Object {
              one: [NestedObjectOne!]!
              two: [NestedObjectTwo!]!
            }
            
            type Query {
              include: Int!
            }
          `,
        ),
      );
    });
  });

  describe('Client schema generation', () => {
    test('that a client schema is produced if a @tag directive is defined on an Object #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on an Object #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a Object Field #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a Object Field #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a Object Field Argument #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a Object Field Argument #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a shared Object Field #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a shared Object Field #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a shared Object Field Argument #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a shared Object Field Argument #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on an Object extension #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on an Object extension #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on an Object extension Field #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on an Object extension Field #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on an Object extension Field Argument #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on an Object extension Field Argument #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a shared Object extension Field #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a shared Object extension Field #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a shared Object extension Field Argument #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a shared Object extension Field Argument #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on an Interface #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on an Interface #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a Interface Field #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a Interface Field #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a Interface Field Argument #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a Interface Field Argument #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a shared Interface Field #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a shared Interface Field #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a shared Interface Field Argument #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a shared Interface Field Argument #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on an Input Object #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphN, subgraphO]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            input Input @tag(name: "one") {
              name: String
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
              name: String
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that a client schema is produced if a @tag directive is defined on an Input Object #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphO, subgraphN]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            input Input @tag(name: "one") {
              name: String
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
              name: String
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that a client schema is produced if a @tag directive is defined on an Input Object Field #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphN, subgraphP]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            input Input {
              name: String @tag(name: "one")
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
              name: String
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that a client schema is produced if a @tag directive is defined on an Input Object Field #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphP, subgraphN]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            input Input {
              name: String @tag(name: "one")
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
              name: String
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that a client schema is produced if a @tag directive is defined on an Enum #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphAB, subgraphAC]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            enum Enum @tag(name: "one") {
              ONE
              TWO
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            enum Enum {
              ONE
              TWO
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that a client schema is produced if a @tag directive is defined on an Enum #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphAC, subgraphAB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            enum Enum @tag(name: "one") {
              ONE
              TWO
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            enum Enum {
              ONE
              TWO
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that a client schema is produced if a @tag directive is defined on an Enum Value #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphAB, subgraphAD]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            enum Enum {
              ONE
              TWO @tag(name: "one")
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            enum Enum {
              ONE
              TWO
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that a client schema is produced if a @tag directive is defined on an Enum Value #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphAD, subgraphAB]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            enum Enum {
              ONE
              TWO @tag(name: "one")
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            enum Enum {
              ONE
              TWO
            }

            type Query {
              dummy: String!
            }
          `,
        ),
      );
    });

    test('that a client schema is produced if a @tag directive is defined on a Scalar #1.1', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a Scalar #1.2', () => {
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

    test('that a client schema is produced if a @tag directive is defined on a Union #1.1', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphS, subgraphT]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            type Entity @tag(name: "includeMe") {
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

    test('that a client schema is produced if a @tag directive is defined on a Union #1.2', () => {
      const { errors, federationResult } = federateSubgraphs([subgraphT, subgraphS]);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(federationResult!.federatedGraphSchema)).toBe(
        normalizeString(
          versionOneRouterDefinitions +
            `
            type Entity @tag(name: "includeMe") {
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
});

const subgraphOne: Subgraph = {
  name: 'subgraph-one',
  url: '',
  definitions: parse(`
    type Object @tag(name: "one") {
      name: String!
    }

    type ObjectTwo @tag(name: "two") {
      name: String!
    }
  `),
};

const subgraphInclude: Subgraph = {
  name: 'subgraph-include',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
      include: Int! @tag(name: "includeMe")
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
      name: String
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
      name: String
    }
  `),
};

const subgraphP: Subgraph = {
  name: 'subgraph-p',
  url: '',
  definitions: parse(`
    input Input {
      name: String @tag(name: "one")
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
    type Entity @key(fields: "id") @tag(name: "includeMe") {
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

const subgraphAA: Subgraph = {
  name: 'subgraph-aa',
  url: '',
  definitions: parse(`
    input Input {
      age: Int @tag(name: "one")
      name: String
    }
  `),
};

const subgraphAB: Subgraph = {
  name: 'subgraph-ab',
  url: '',
  definitions: parse(`
    enum Enum {
      ONE
    }

    type Query {
      dummy: String!
    }
  `),
};

const subgraphAC: Subgraph = {
  name: 'subgraph-ac',
  url: '',
  definitions: parse(`
    enum Enum @tag(name: "one") {
      TWO
    }
  `),
};

const subgraphAD: Subgraph = {
  name: 'subgraph-ad',
  url: '',
  definitions: parse(`
    enum Enum {
      TWO @tag(name: "one")
    }
  `),
};

const subgraphAE: Subgraph = {
  name: 'subgraph-ae',
  url: '',
  definitions: parse(`
    interface Interface @tag(name: "one") {
      name: String!
    }

    type Object implements Interface @tag(name: "includeMe") {
      name: String!
    }
  `),
};

const subgraphAF: Subgraph = {
  name: 'subgraph-af',
  url: '',
  definitions: parse(`
    type Object {
      field(input: Input @tag(name: "one")): String! @tag(name: "includeMe")
    }
    
    input Input {
      name: String @tag(name: "one")
    }
  `),
};

const subgraphAG: Subgraph = {
  name: 'subgraph-ag',
  url: '',
  definitions: parse(`
    type Object {
      field(input: [Input] @tag(name: "one")): String! @tag(name: "includeMe")
    }
    
    input Input {
      name: String @tag(name: "one")
    }
  `),
};

const subgraphAH: Subgraph = {
  name: 'subgraph-ah',
  url: '',
  definitions: parse(`
    type Object {
      field(input: [Input] = [] @tag(name: "one")): String! @tag(name: "one") @tag(name: "includeMe")
    }
    
    input Input {
      name: String @tag(name: "one")
    }
  `),
};

const subgraphAI: Subgraph = {
  name: 'subgraph-ai',
  url: '',
  definitions: parse(`
    type Object @tag(name: "one") {
      one: [NestedObjectOne!]!
      two: [NestedObjectTwo!]!
    }
    
    type NestedObjectOne @tag(name: "one") {
      nested: NestedObjectTwo!
    }
    
    type NestedObjectTwo @tag(name: "one") {
      enum: Enum!
    }

    enum Enum @tag(name: "one") {
      A
    }
  `),
};

const subgraphAJ: Subgraph = {
  name: 'subgraph-aj',
  url: '',
  definitions: parse(`
    input Input {
      name: String @tag(name: "one")
    }
    
    type Query {
      field(input: [Input] = [] @tag(name: "one")): String! @tag(name: "one")
    }
  `),
};

const subgraphAK: Subgraph = {
  name: 'subgraph-ak',
  url: '',
  definitions: parse(`
    input Input {
      age: Int
      name: String
    }

    type Query {
      dummy: String!
    }
  `),
};
