import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as graphqlParse, type DocumentNode } from 'graphql';
import { describe, expect, test } from 'vitest';
import { parseSdl, SdlParserFallback } from '../../src/ast/sdl-parser';
import { parse, safeParseFieldSet } from '../../src/ast/utils';

function assertAstEqual(actual: DocumentNode, expected: DocumentNode) {
  expect(actual).toStrictEqual(expected);
}

function errorFrom(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return error as Error & { locations?: ReadonlyArray<{ line: number; column: number }> };
  }
  throw new Error('Expected function to throw.');
}

function graphqlFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...graphqlFiles(path));
    } else if (entry.endsWith('.graphql')) {
      out.push(path);
    }
  }
  return out;
}

function isTypeSystemDocument(document: DocumentNode) {
  return document.definitions.every(
    (definition) => definition.kind !== 'OperationDefinition' && definition.kind !== 'FragmentDefinition',
  );
}

const scenarioDir = join(__dirname, '../../bench/scenario');

const validSnippets = [
  `type Query { id: ID! name: String }`,
  `type type { true: String null: Int on: Boolean }`,
  `extend type Query { extra: String }`,
  `extend type Query @key(fields: "id")`,
  `interface Node { id: ID! }`,
  `interface Resource implements Node { id: ID! url: String }`,
  `extend interface Node { label: String }`,
  `extend interface Node @tag(name: "node")`,
  `type Product implements Resource & Node { id: ID! url: String sku: String }`,
  `type Product implements & Resource & Node { id: ID }`,
  `union Search = Product | User`,
  `union Search = | Product | User`,
  `extend union Search = Review`,
  `extend union Search @tag(name: "search")`,
  `enum Color { RED GREEN BLUE }`,
  `enum Color { "warm" RED @deprecated(reason: "Use GREEN") GREEN }`,
  `extend enum Color { PURPLE }`,
  `extend enum Color @tag(name: "color")`,
  `input Filter { text: String limit: Int = 10 nested: [FilterInput!] } input FilterInput { a: Int }`,
  `extend input Filter { active: Boolean = true }`,
  `extend input Filter @oneOf`,
  `scalar DateTime`,
  `scalar Url @specifiedBy(url: "https://example.com/url")`,
  `extend scalar DateTime @tag(name: "dt")`,
  `directive @tag(name: String!, meta: Meta = { labels: ["a", "b"], score: -1.2e3 }) repeatable on FIELD_DEFINITION | OBJECT | ARGUMENT_DEFINITION`,
  `directive @link(url: String, import: [String]) on SCHEMA`,
  `schema { query: Query mutation: Mutation subscription: Subscription } type Query { a: String } type Mutation { a: String } type Subscription { a: String }`,
  `schema @tag(name: "root") { query: Query } type Query { a: String }`,
  `extend schema @tag(name: "schema")`,
  `extend schema { mutation: Mutation } type Mutation { a: String }`,
  `"plain description" type Query { "field description" a: String }`,
  `"""
block
description with \\""" escaped triple and emoji 🚀
""" type Query { a: String }`,
  '"crlf\\r\\ntext" type Query { a: String }',
  `# comment
  type Query, { a: String, b(arg: Int, other: [String!] = ["x", "y"],): Float, }`,
  '\uFEFFtype Query { a: String }',
  `type Query { values(input: Input = { a: 1, b: -2.5, c: 1e3, d: false, e: null, f: ENUM, g: [1, { nested: "x" }] }): String } input Input { a: Int }`,
  `type Query @dir(a: { b: [{ c: "d" }] }) { field(arg: String @dir(a: true)): String @dir(a: null) } directive @dir(a: Input) repeatable on OBJECT | FIELD_DEFINITION | ARGUMENT_DEFINITION input Input { a: String }`,
] as const;

const invalidSnippets = [
  `type X {}`,
  `interface X {}`,
  `enum X {}`,
  `input X {}`,
  `type X { a: String = 1 }`,
  `type X { a: String @d(v: 1.) }`,
  `type X { a: String @d(v: 01) }`,
  `type X { a: String @d(v: "unterminated) }`,
  `"""unterminated`,
  `type X implements { a: String }`,
  `directive @d on on`,
  `directive @d on`,
  `}`,
  `type X { a: String } }`,
  `type X { a(: String): String }`,
  `extend type`,
  `type X { a: String @d(v: $x) }`,
] as const;

describe('parseSdl', () => {
  test('matches graphql-js for all benchmark scenario files', () => {
    const files = readdirSync(scenarioDir).filter((fileName) => fileName.endsWith('.graphql'));
    expect(files).toHaveLength(150);
    for (const fileName of files) {
      const sdl = readFileSync(join(scenarioDir, fileName), 'utf8');
      assertAstEqual(parseSdl(sdl), graphqlParse(sdl, { noLocation: true }));
    }
  });

  test('matches graphql-js for hand-written SDL coverage', () => {
    expect(validSnippets.length).toBeGreaterThanOrEqual(30);
    for (const sdl of validSnippets) {
      assertAstEqual(parseSdl(sdl), graphqlParse(sdl, { noLocation: true }));
    }
  });

  test('public parse delegates invalid SDL errors to graphql-js', () => {
    expect(invalidSnippets.length).toBeGreaterThanOrEqual(15);
    for (const sdl of invalidSnippets) {
      const actual = errorFrom(() => parse(sdl));
      const expected = errorFrom(() => graphqlParse(sdl, { noLocation: true }));
      expect(actual.message).toBe(expected.message);
      expect(actual.locations).toStrictEqual(expected.locations);
    }
  });

  test('public parse passes executable documents through graphql-js', () => {
    const fieldSet = safeParseFieldSet('id name');
    expect(fieldSet.error).toBeUndefined();
    assertAstEqual(fieldSet.documentNode!, graphqlParse('{id name}', { noLocation: true }));

    const query = `query GetUser($id: ID!) { user(id: $id) { id name } }`;
    assertAstEqual(parse(query), graphqlParse(query, { noLocation: true }));
  });

  test('real unstaged SDL files match graphql-js or explicitly fall back', () => {
    const files = graphqlFiles(join(__dirname, 'unstaged-tests'));
    let checked = 0;
    let fallbacks = 0;
    for (const file of files) {
      const sdl = readFileSync(file, 'utf8');
      const expected = graphqlParse(sdl, { noLocation: true });
      if (!isTypeSystemDocument(expected)) {
        continue;
      }
      checked++;
      try {
        assertAstEqual(parseSdl(sdl), expected);
      } catch (error) {
        if (!(error instanceof SdlParserFallback)) {
          throw error;
        }
        fallbacks++;
      }
    }
    console.info(`parseSdl real-schema differential: ${checked} SDL files, ${fallbacks} fallbacks`);
  }, 30_000);
});
