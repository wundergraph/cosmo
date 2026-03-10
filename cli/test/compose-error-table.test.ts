import { describe, test, expect } from 'vitest';
import { parse } from 'graphql';
import Table from 'cli-table3';
import pc from 'picocolors';
import { federateSubgraphs, ROUTER_COMPATIBILITY_VERSION_ONE } from '@wundergraph/composition';
import { wrapText, TABLE_CONTENT_WIDTH } from '../src/wrap-text.js';

// Exact reproduction schemas from https://github.com/wundergraph/cosmo/issues/2619
// subgraph-b overrides `description` from subgraph-c, while subgraph-c overrides
// `description` from subgraph-b — a circular override that produces composition errors.

const subgraphASchema = /* GraphQL */ `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.5", import: ["@key"])

  type Query {
    foos: [Foo!]!
  }

  type Foo @key(fields: "id") {
    id: ID!
    name: String!
  }
`;

const subgraphBSchema = /* GraphQL */ `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.5", import: ["@key", "@external", "@override"])

  type Query {
    bars: [Bar!]!
  }

  type Foo @key(fields: "id") {
    id: ID!
    description: String! @override(from: "subgraph-c")
  }

  type Bar @key(fields: "id") {
    id: ID!
    title: String!
  }
`;

const subgraphCSchema = /* GraphQL */ `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.5", import: ["@key", "@external", "@override"])

  type Query {
    baz: String
  }

  type Foo @key(fields: "id") {
    id: ID!
    description: String! @override(from: "subgraph-b")
  }
`;

const subgraphDSchema = /* GraphQL */ `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.5", import: ["@key"])

  type Query {
    qux: [Qux!]!
  }

  type Qux @key(fields: "id") {
    id: ID!
    value: Int!
  }
`;

describe('Router compose error table rendering (#2619)', () => {
  test(
    'composition with 4 subgraphs and circular override produces errors without hanging',
    () => {
      // Step 1: Compose the exact 4 subgraphs from the issue
      const result = federateSubgraphs({
        subgraphs: [
          { name: 'subgraph-a', url: 'http://localhost:4001/graphql', definitions: parse(subgraphASchema) },
          { name: 'subgraph-b', url: 'http://localhost:4002/graphql', definitions: parse(subgraphBSchema) },
          { name: 'subgraph-c', url: 'http://localhost:4003/graphql', definitions: parse(subgraphCSchema) },
          { name: 'subgraph-d', url: 'http://localhost:4004/graphql', definitions: parse(subgraphDSchema) },
        ],
        version: ROUTER_COMPATIBILITY_VERSION_ONE,
      });

      // Step 2: Verify composition fails with errors (circular override)
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);

        // Step 3: Reproduce the exact table rendering path from compose.ts
        // This is the code path that deadlocked before the fix.
        const compositionErrorsTable = new Table({
          head: [pc.bold(pc.white('ERROR_MESSAGE'))],
          colWidths: [120],
        });

        for (const compositionError of result.errors) {
          compositionErrorsTable.push([wrapText(compositionError.message, TABLE_CONTENT_WIDTH)]);
        }

        // Step 4: This call hung indefinitely before the fix
        const tableOutput = compositionErrorsTable.toString();

        // Step 5: Verify the table rendered correctly
        expect(tableOutput).toBeTruthy();
        expect(tableOutput.length).toBeGreaterThan(0);
        // The error should mention the override conflict
        expect(tableOutput).toContain('override');
      }
    },
    // 5 second timeout — the original bug caused an indefinite hang
    5_000,
  );
});
