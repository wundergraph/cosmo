import { buildSchema } from 'graphql';
import { LintSeverity } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { describe, expect, test, vi } from 'vitest';
import { FederatedGraphDTO } from '../../types/index.js';
import { SchemaDiff } from '../composition/schemaCheck.js';
import SchemaGraphPruner from './SchemaGraphPruner.js';

// The pruner only touches `getSubgraphFieldsInGracePeriod` on the subgraph repository and
// `getUnusedFields` / `getUsedFields` on the usage repository, so both can be stubbed and the
// field bookkeeping exercised without the Postgres/ClickHouse test harness.
const schema = buildSchema(/* GraphQL */ `
  type Query {
    employees: [Employee!]!
    employee(id: ID!): Employee
    products: [Product!]!
  }

  type Employee {
    id: ID!
    name: String!
    nickname: String @deprecated(reason: "Use name instead")
  }

  type Product {
    upc: String!
    price: Int!
  }
`);

const federatedGraphs = [
  { id: 'fg-1', name: 'graph-one' },
  { id: 'fg-2', name: 'graph-two' },
] as unknown as FederatedGraphDTO[];

const fieldDiff = (path: string): SchemaDiff => ({
  changeType: 'FIELD_ADDED',
  message: `Field '${path}' was added`,
  path,
  isBreaking: false,
  meta: {} as SchemaDiff['meta'],
});

describe('SchemaGraphPruner', () => {
  test('reports unused fields per federated graph, excluding grace period and newly added fields', async () => {
    const getUnusedFields = vi.fn(
      ({ federatedGraphId, fields }: { federatedGraphId: string; fields: { name: string; typeName: string }[] }) => {
        // graph-one has traffic on everything but Employee.name, graph-two has no traffic at all
        if (federatedGraphId === 'fg-1') {
          return Promise.resolve(fields.filter((f) => f.typeName === 'Employee' && f.name === 'name'));
        }
        return Promise.resolve(fields.map((f) => ({ name: f.name, typeName: f.typeName })));
      },
    );
    const subgraphRepo = {
      getSubgraphFieldsInGracePeriod: vi.fn().mockResolvedValue([{ path: 'Product.price' }]),
    };
    const pruner = new SchemaGraphPruner({} as any, subgraphRepo as any, { getUnusedFields } as any, schema);

    const issues = await pruner.fetchUnusedFields({
      subgraphId: 'sg-1',
      namespaceId: 'ns-1',
      organizationId: 'org-1',
      federatedGraphs,
      rangeInDays: 7,
      addedFields: [fieldDiff('Query.products')],
      severityLevel: 'error',
    });

    // Fields in grace period and fields added by this check are never sent to ClickHouse
    const checkedPaths = getUnusedFields.mock.calls[0][0].fields.map(
      (f: { typeName: string; name: string }) => `${f.typeName}.${f.name}`,
    );
    expect(checkedPaths).not.toContain('Product.price');
    expect(checkedPaths).not.toContain('Query.products');
    expect(checkedPaths).toContain('Employee.name');
    expect(getUnusedFields).toHaveBeenCalledTimes(2);

    const byGraph = (id: string) => issues.filter((i) => i.federatedGraphId === id).map((i) => i.fieldPath);
    expect(byGraph('fg-1')).toEqual(['Employee.name']);
    // Order follows the schema field order, not the order ClickHouse returned the rows in
    expect(byGraph('fg-2')).toEqual([
      'Query.employees',
      'Query.employee',
      'Employee.id',
      'Employee.name',
      'Employee.nickname',
      'Product.upc',
    ]);
    expect(issues.every((i) => i.graphPruningRuleType === 'UNUSED_FIELDS' && i.severity === LintSeverity.error)).toBe(
      true,
    );
  });

  test('reports deprecated fields with their usage state', async () => {
    const getUsedFields = vi.fn(({ federatedGraphId }: { federatedGraphId: string }) =>
      Promise.resolve(federatedGraphId === 'fg-1' ? [{ name: 'nickname', typeName: 'Employee' }] : []),
    );
    const subgraphRepo = {
      getSubgraphFieldsInGracePeriod: vi.fn().mockResolvedValue([]),
    };
    const pruner = new SchemaGraphPruner({} as any, subgraphRepo as any, { getUsedFields } as any, schema);

    const issues = await pruner.fetchDeprecatedFields({
      subgraphId: 'sg-1',
      namespaceId: 'ns-1',
      organizationId: 'org-1',
      federatedGraphs,
      rangeInDays: 7,
      severityLevel: 'warn',
      addedDeprecatedFields: [],
    });

    expect(issues).toHaveLength(2);
    expect(issues.find((i) => i.federatedGraphId === 'fg-1')?.message).toContain('still in use');
    expect(issues.find((i) => i.federatedGraphId === 'fg-2')?.message).toContain('no longer in use');
    expect(issues.every((i) => i.fieldPath === 'Employee.nickname' && i.severity === LintSeverity.warn)).toBe(true);
  });

  test('skips deprecated field checks when all deprecated fields are excluded', async () => {
    const getUsedFields = vi.fn();
    const subgraphRepo = {
      getSubgraphFieldsInGracePeriod: vi.fn().mockResolvedValue([{ path: 'Employee.nickname' }]),
    };
    const pruner = new SchemaGraphPruner({} as any, subgraphRepo as any, { getUsedFields } as any, schema);

    const issues = await pruner.fetchDeprecatedFields({
      subgraphId: 'sg-1',
      namespaceId: 'ns-1',
      organizationId: 'org-1',
      federatedGraphs,
      rangeInDays: 7,
      severityLevel: 'warn',
      addedDeprecatedFields: [],
    });

    expect(issues).toEqual([]);
    expect(getUsedFields).not.toHaveBeenCalled();
  });

  test('flags fields removed without prior deprecation for every federated graph', () => {
    const pruner = new SchemaGraphPruner({} as any, {} as any, {} as any, schema);

    const issues = pruner.fetchNonDeprecatedDeletedFields({
      federatedGraphs,
      severityLevel: 'error',
      removedFields: [
        { ...fieldDiff('Employee.nickname'), changeType: 'FIELD_REMOVED' },
        { ...fieldDiff('Employee.name'), changeType: 'FIELD_REMOVED' },
      ],
      oldSchema: /* GraphQL */ `
        type Query {
          employees: [Employee!]!
        }

        type Employee {
          id: ID!
          name: String!
          nickname: String @deprecated(reason: "Use name instead")
        }
      `,
    });

    // `nickname` was deprecated before removal and is fine; `name` was not
    expect(issues.map((i) => [i.federatedGraphId, i.fieldPath])).toEqual([
      ['fg-1', 'Employee.name'],
      ['fg-2', 'Employee.name'],
    ]);
  });
});
