import { federateSubgraphsWithContracts, Subgraph } from '../src';
import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  normalizeString,
  schemaQueryDefinition,
  schemaToSortedNormalizedString,
  versionOneRouterContractDefinitions,
} from './utils/utils';

describe('Contract tests', () => {
  const tagsToExcludeByContractName = new Map<string, Set<string>>([
    ['one', new Set<string>(['excludeMe'])],
    ['two', new Set<string>(['excludeMeTwo'])],
  ]);

  test('that objects are removed by tag', () => {
    const { federationResultContainerByContractName } = federateSubgraphsWithContracts(
      [subgraphA, subgraphB],
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
});

const subgraphA: Subgraph = {
  name: 'subgraph-a',
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

const subgraphB: Subgraph = {
  name: 'subgraph-b',
  url: '',
  definitions: parse(`
    type Query {
      dummy: String!
    }
  `),
};
