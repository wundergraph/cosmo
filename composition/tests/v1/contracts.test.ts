import {
  ContractTagOptions,
  federateSubgraphs,
  federateSubgraphsContract,
  federateSubgraphsWithContracts,
  FederationResultSuccess,
  FederationResultWithContractsSuccess,
  parse,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '../../src';
import { describe, expect, test } from 'vitest';
import { schemaQueryDefinition, versionOneRouterContractDefinitions, versionOneRouterDefinitions } from './utils/utils';
import { normalizeString, schemaToSortedNormalizedString } from '../utils/utils';

describe('Contract tests', () => {
  describe('Exclude tags', () => {
    const excludedTagsOne: ContractTagOptions = {
      tagNamesToExclude: new Set<string>(['one', 'includeMe']),
      tagNamesToInclude: new Set<string>(),
    };

    const excludedTagsTwo: ContractTagOptions = {
      tagNamesToExclude: new Set<string>(['one']),
      tagNamesToInclude: new Set<string>(),
    };

    test('that Objects are removed by tag', () => {
      const result = federateSubgraphsWithContracts(
        [subgraphOne, subgraphA],
        new Map<string, ContractTagOptions>([
          ['one', excludedTagsOne],
          [
            'two',
            {
              tagNamesToExclude: new Set<string>(['two', 'includeMe']),
              tagNamesToInclude: new Set<string>(),
            },
          ],
        ]),
      ) as FederationResultWithContractsSuccess;
      expect(result.success).toBe(true);
      expect(result.federationResultByContractName).toBeDefined();
      const contractOne = result.federationResultByContractName!.get('one') as FederationResultSuccess;
      expect(contractOne.success).toBe(true);
      const contractTwo = result.federationResultByContractName!.get('two') as FederationResultSuccess;
      expect(contractTwo.success).toBe(true);
      expect(schemaToSortedNormalizedString(contractOne.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(contractOne.federatedGraphClientSchema!)).toBe(
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
      expect(schemaToSortedNormalizedString(contractTwo.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(contractTwo.federatedGraphClientSchema!)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphB, subgraphD],
        excludedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphA, subgraphD],
        excludedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphJ, subgraphK],
        excludedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphJ, subgraphL],
        excludedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphA, subgraphL],
        excludedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphA, subgraphAE],
        excludedTagsTwo,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphN, subgraphO],
        excludedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphAA, subgraphAK],
        excludedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphA, subgraphP],
        excludedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphA, subgraphAF],
        excludedTagsTwo,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphA, subgraphAG],
        excludedTagsTwo,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphA, subgraphAH],
        excludedTagsTwo,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphQ, subgraphR],
        excludedTagsTwo,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphS, subgraphT],
        excludedTagsTwo,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphS, subgraphG],
        excludedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphAB, subgraphAC],
        excludedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphAB, subgraphAD],
        excludedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphA, subgraphAD],
        excludedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphA, subgraphAI],
        excludedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
    const includedTagsOne: ContractTagOptions = {
      tagNamesToExclude: new Set<string>(),
      tagNamesToInclude: new Set<string>(['one', 'includeMe']),
    };

    const includedTagsTwo: ContractTagOptions = {
      tagNamesToExclude: new Set<string>(),
      tagNamesToInclude: new Set<string>(['two', 'includeMe']),
    };

    const includedTagsThree: ContractTagOptions = {
      tagNamesToExclude: new Set<string>(),
      tagNamesToInclude: new Set<string>(['includeMe']),
    };

    test('that Objects are included by tag', () => {
      const result = federateSubgraphsWithContracts(
        [subgraphOne, subgraphInclude],
        new Map<string, ContractTagOptions>([
          ['one', includedTagsOne],
          ['two', includedTagsTwo],
        ]),
      ) as FederationResultWithContractsSuccess;
      expect(result.success).toBe(true);
      const contractOne = result.federationResultByContractName!.get('one') as FederationResultSuccess;
      expect(contractOne.success).toBe(true);
      const contractTwo = result.federationResultByContractName!.get('two') as FederationResultSuccess;
      expect(contractTwo.success).toBe(true);
      expect(schemaToSortedNormalizedString(contractOne.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(contractOne.federatedGraphClientSchema!)).toBe(
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
      expect(schemaToSortedNormalizedString(contractTwo.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(contractTwo.federatedGraphClientSchema!)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphB, subgraphD, subgraphInclude],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphD],
        includedTagsTwo,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphJ, subgraphK, subgraphInclude],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphJ, subgraphL, subgraphInclude],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphL],
        includedTagsTwo,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphAE],
        includedTagsTwo,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphN, subgraphO, subgraphInclude],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphAA, subgraphAK, subgraphInclude],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphP],
        includedTagsThree,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphAF],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphAG],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphAH],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphAJ],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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

    test('that if a Field is included, its Arguments are included by default', () => {
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphAL],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
        normalizeString(
          schemaQueryDefinition +
            `
            type Object {
              name: String!
            }

            type Query {
              field(input: ID!): Object!
              include: Int!
            }
          `,
        ),
      );
    });

    test('that a Scalar is included by tag', () => {
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphQ, subgraphR],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphS, subgraphT],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphS, subgraphG],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphAB, subgraphAC],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphAB, subgraphAD],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphAD],
        includedTagsThree,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphsContract(
        [subgraphInclude, subgraphAI],
        includedTagsOne,
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphB, subgraphC],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphC, subgraphB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphB, subgraphD],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphD, subgraphB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphB, subgraphE],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphE, subgraphB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphU, subgraphD],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphD, subgraphU],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphV, subgraphE],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphE, subgraphV],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphG, subgraphF],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphF, subgraphG],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphH, subgraphF],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphF, subgraphH],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphF, subgraphI],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphF, subgraphI],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphW, subgraphH],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphH, subgraphW],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphX, subgraphI],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphI, subgraphX],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphJ, subgraphK],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphK, subgraphJ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphJ, subgraphL],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphL, subgraphJ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphJ, subgraphM],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphM, subgraphJ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphY, subgraphL],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphL, subgraphY],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphZ, subgraphM],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphM, subgraphZ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphN, subgraphO],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphO, subgraphN],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphN, subgraphP],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphP, subgraphN],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphAB, subgraphAC],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphAC, subgraphAB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphAB, subgraphAD],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphAD, subgraphAB],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphQ, subgraphR],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphR, subgraphQ],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphS, subgraphT],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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
      const result = federateSubgraphs(
        [subgraphT, subgraphS],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      ) as FederationResultSuccess;
      expect(result.success).toBe(true);
      expect(schemaToSortedNormalizedString(result.federatedGraphSchema)).toBe(
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
      expect(schemaToSortedNormalizedString(result.federatedGraphClientSchema)).toBe(
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

const subgraphAL: Subgraph = {
  name: 'subgraph-al',
  url: '',
  definitions: parse(`
    type Object @tag(name: "one") {
      name: String!
    }
    
    type Query {
      field(input: ID!): Object! @tag(name: "one")
    }
  `),
};
