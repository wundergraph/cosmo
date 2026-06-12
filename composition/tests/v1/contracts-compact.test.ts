import { type ContractTagOptions, parse, ROUTER_COMPATIBILITY_VERSION_ONE, type Subgraph } from '../../src';
import { describe, expect, test } from 'vitest';
import { SCHEMA_QUERY_DEFINITION, TAG_DIRECTIVE } from './utils/utils';
import { federateSubgraphsWithContractsSuccess, normalizeString, schemaToSortedNormalizedString } from '../utils/utils';

describe('Contract compact collection tests', () => {
  test('preserves compact field metadata after cloning contract federation factories', () => {
    const { federationResultByContractName } = federateSubgraphsWithContractsSuccess(
      [inventorySubgraph, catalogSubgraph],
      new Map<string, ContractTagOptions>([
        [
          'public',
          {
            tagNamesToExclude: new Set<string>(['internal']),
            tagNamesToInclude: new Set<string>(),
          },
        ],
      ]),
      ROUTER_COMPATIBILITY_VERSION_ONE,
    );

    const contract = federationResultByContractName?.get('public');
    if (!contract?.success) {
      expect(contract?.success).toBe(true);
      return;
    }
    expect(schemaToSortedNormalizedString(contract.federatedGraphSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          TAG_DIRECTIVE +
          `
            type Hidden @tag(name: "internal") @inaccessible {
              id: ID!
            }

            type Product {
              sku: ID!
              title: String!
            }

            type Query {
              hidden: Hidden! @tag(name: "internal") @inaccessible
              product: Product!
            }
          `,
      ),
    );
    expect(contract.federatedGraphClientSchema).toBeDefined();
    if (!contract.federatedGraphClientSchema) {
      return;
    }
    expect(schemaToSortedNormalizedString(contract.federatedGraphClientSchema)).toBe(
      normalizeString(
        SCHEMA_QUERY_DEFINITION +
          `
            type Product {
              sku: ID!
              title: String!
            }

            type Query {
              product: Product!
            }
          `,
      ),
    );
  });
});

const inventorySubgraph: Subgraph = {
  name: 'inventory',
  url: '',
  definitions: parse(`
    type Query @shareable {
      product: Product!
      hidden: Hidden! @tag(name: "internal")
    }

    type Product @shareable {
      sku: ID!
      title: String!
    }

    type Hidden @tag(name: "internal") {
      id: ID!
    }
  `),
};

const catalogSubgraph: Subgraph = {
  name: 'catalog',
  url: '',
  definitions: parse(`
    type Query @shareable {
      product: Product!
    }

    type Product @shareable {
      sku: ID!
      title: String!
    }
  `),
};
