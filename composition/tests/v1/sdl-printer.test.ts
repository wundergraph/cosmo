import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildASTSchema, lexicographicSortSchema, parse, type DocumentNode } from 'graphql';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import { describe, expect, test } from 'vitest';
import { federateSubgraphs, printSortedSdl, type Subgraph } from '../../src';

const normalize = (input: string) => input.replace(/\s+/g, ' ').trim();

function referencePipeline(document: DocumentNode): string {
  return printSchemaWithDirectives(
    lexicographicSortSchema(
      buildASTSchema(document, {
        assumeValid: true,
        assumeValidSDL: true,
      }),
    ),
  );
}

const snippets: Array<{ name: string; sdl: string }> = [
  {
    name: 'sorts schema, directives, and object fields naturally',
    sdl: `
      schema { query: Query }
      directive @a10 on FIELD_DEFINITION
      directive @a2 on FIELD_DEFINITION
      type Query {
        z10: String
        z2: String
        z1: String
      }
    `,
  },
  {
    name: 'prints non-default schema roots',
    sdl: `
      schema {
        query: RootQuery
        mutation: RootMutation
        subscription: RootSubscription
      }
      type RootQuery { a: String }
      type RootMutation { a: String }
      type RootSubscription { a: String }
    `,
  },
  {
    name: 'prints schema directives with default root name',
    sdl: `
      directive @composeDirective(name: String!) repeatable on SCHEMA
      schema @composeDirective(name: "@tag") { query: Query }
      type Query { a: String }
    `,
  },
  {
    name: 'prints schema descriptions',
    sdl: `
      "Schema description"
      schema { query: Query }
      type Query { a: String }
    `,
  },
  {
    name: 'omits specified directives and specified scalars',
    sdl: `
      directive @custom on FIELD_DEFINITION
      scalar String
      scalar Boolean
      type Query { a: String @custom }
    `,
  },
  {
    name: 'prints custom scalar with specifiedBy',
    sdl: `
      scalar Url @specifiedBy(url: "https://example.com/url")
      type Query { url: Url }
    `,
  },
  {
    name: 'prints repeatable directives and sorted locations',
    sdl: `
      directive @tag(name: String!) repeatable on OBJECT | FIELD_DEFINITION | ARGUMENT_DEFINITION
      type Query @tag(name: "root") { a(arg: String @tag(name: "arg")): String @tag(name: "field") }
    `,
  },
  {
    name: 'prints field arguments with descriptions on separate lines',
    sdl: `
      directive @d on ARGUMENT_DEFINITION
      type Query {
        a(
          "described arg"
          b: String @d
          a: Int = 1
        ): String
      }
    `,
  },
  {
    name: 'prints nested type references',
    sdl: `
      type Query {
        a(input: [[Input!]!]!): [Result!]!
      }
      input Input { value: String! }
      type Result { value: String! }
    `,
  },
  {
    name: 'prints every value kind in directive arguments',
    sdl: `
      directive @values(
        int: Int
        float: Float
        string: String
        boolean: Boolean
        enum: Choice
        nullValue: String
        list: [Int]
        object: Input
      ) on FIELD_DEFINITION
      enum Choice { A B }
      input Input { a: Int b: String c: [Choice] }
      type Query {
        a: String @values(int: 1, float: 1.0, string: "line\\nquote\\"", boolean: true, enum: A, nullValue: null, list: [1, 2], object: { b: "x", a: 1, c: [B, A] })
      }
    `,
  },
  {
    name: 'coerces single directive values for list arguments',
    sdl: `
      directive @values(items: [Int]) on FIELD_DEFINITION
      type Query { a: String @values(items: 1) }
    `,
  },
  {
    name: 'normalizes default input values',
    sdl: `
      enum Choice { A B }
      input Child { b: String a: Int }
      input Input {
        a: Float = 1.0
        b: [Int] = 1
        c: Child = { b: "x", a: 1 }
        d: Choice = B
      }
      type Query { a(input: Input = { c: { a: 1, b: "x" }, b: 1, d: B, a: 1.0 }): String }
    `,
  },
  {
    name: 'prints object field directives and deprecations',
    sdl: `
      directive @custom(v: String = "x") on FIELD_DEFINITION | OBJECT
      type Query @custom {
        a: String @deprecated
        b: String @deprecated(reason: "Use a")
        c: String @custom(v: "y")
      }
    `,
  },
  {
    name: 'prints enum directives and deprecations',
    sdl: `
      directive @custom on ENUM | ENUM_VALUE
      enum Choice @custom {
        A @deprecated
        B @deprecated(reason: "Use A")
        C @custom
      }
      type Query { choice: Choice }
    `,
  },
  {
    name: 'prints interfaces implementing interfaces',
    sdl: `
      interface Node { id: ID! }
      interface Resource implements Node { id: ID! url: String }
      type Page implements Resource & Node { id: ID! url: String title: String }
      type Query { page: Page }
    `,
  },
  {
    name: 'sorts union member types naturally',
    sdl: `
      type A10 { id: ID }
      type A2 { id: ID }
      type A1 { id: ID }
      union Search = A10 | A2 | A1
      type Query { search: Search }
    `,
  },
  {
    name: 'prints empty object, interface, input, enum, and union definitions',
    sdl: `
      type EmptyObject
      interface EmptyInterface
      input EmptyInput
      enum EmptyEnum
      union EmptyUnion
      type Query { a: String }
    `,
  },
  {
    name: 'prints oneOf input objects',
    sdl: `
      input Filter @oneOf { id: ID name: String }
      type Query { a(filter: Filter): String }
    `,
  },
  {
    name: 'prints block descriptions with triple quotes',
    sdl: `
      """
      multiline
      has \\""" triple quotes
      """
      type Query {
        a: String
      }
    `,
  },
  {
    name: 'prints quoted descriptions with leading whitespace',
    sdl: `
      " leading and trailing "
      type Query {
        a: String
      }
    `,
  },
  {
    name: 'prints descriptions with emoji and quotes',
    sdl: `
      "emoji 🚀 and quote \\""
      type Query {
        "field emoji 🚀"
        a: String
      }
    `,
  },
  {
    name: 'escapes string default values',
    sdl: `
      input Input {
        value: String = "line\\nquote\\"slash\\\\"
      }
      type Query { a(input: Input): String }
    `,
  },
  {
    name: 'prints directive definition argument defaults',
    sdl: `
      directive @d(
        a: String = "line\\n"
        b: Float = 1.0
        c: [Int] = 1
      ) on FIELD_DEFINITION
      type Query { a: String @d }
    `,
  },
  {
    name: 'keeps custom directives named like specified directives',
    sdl: `
      directive @deprecated(reason: String = "No longer supported") on FIELD_DEFINITION
      type Query { a: String @deprecated(reason: "No longer supported") }
    `,
  },
  {
    name: 'prints schema with only mutation root',
    sdl: `
      schema { mutation: Mutation }
      type Mutation { a: String }
    `,
  },
  {
    name: 'prints input field directives',
    sdl: `
      directive @tag(name: String!) repeatable on INPUT_OBJECT | INPUT_FIELD_DEFINITION
      input Input @tag(name: "input") { a: String @tag(name: "field") }
      type Query { a(input: Input): String }
    `,
  },
  {
    name: 'moves field deprecated directive after other directives',
    sdl: `
      directive @fuzz(v: Int) on FIELD_DEFINITION
      type Query {
        f: Int @deprecated(reason: "x") @fuzz(v: 1)
      }
    `,
  },
  {
    name: 'moves enum value deprecated directive after other directives',
    sdl: `
      directive @fuzz(v: Int) on ENUM_VALUE
      enum E {
        A @deprecated(reason: "x") @fuzz(v: 1)
      }
      type Query { e: E }
    `,
  },
  {
    name: 'moves input field deprecated directive after other directives',
    sdl: `
      directive @fuzz(v: Int) on INPUT_FIELD_DEFINITION
      input Input {
        a: Int @deprecated(reason: "x") @fuzz(v: 1)
      }
      type Query { f(input: Input): Int }
    `,
  },
  {
    name: 'moves argument deprecated directive after other directives',
    sdl: `
      directive @fuzz(v: Int) on ARGUMENT_DEFINITION
      type Query {
        f(a: Int @deprecated(reason: "x") @fuzz(v: 1)): Int
      }
    `,
  },
  {
    name: 'moves field deprecated directive from first of three to last',
    sdl: `
      directive @a on FIELD_DEFINITION
      directive @z on FIELD_DEFINITION
      type Query {
        f: Int @deprecated(reason: "x") @z @a
      }
    `,
  },
  {
    name: 'moves custom deprecated directive by specified directive name',
    sdl: `
      directive @deprecated(reason: String = "No longer supported") on FIELD_DEFINITION
      directive @fuzz(v: Int) on FIELD_DEFINITION
      type Query {
        f: Int @deprecated(reason: "x") @fuzz(v: 1)
      }
    `,
  },
  {
    name: 'drops argument default with non-member enum literal',
    sdl: `
      enum Color { RED GREEN }
      type Query {
        f(arg: Color = B10): Int
      }
    `,
  },
  {
    name: 'drops input field default with non-member enum literal',
    sdl: `
      enum Color { RED GREEN }
      input Input {
        color: Color = B10
      }
      type Query { f(input: Input): Int }
    `,
  },
  {
    name: 'drops directive definition argument default with non-member enum literal',
    sdl: `
      enum Color { RED GREEN }
      directive @fuzz(color: Color = B10) on FIELD_DEFINITION
      type Query { f: Int }
    `,
  },
  {
    name: 'drops list default containing non-member enum literal',
    sdl: `
      enum Color { RED GREEN }
      type Query {
        f(arg: [Color] = [RED, B10]): Int
      }
    `,
  },
  {
    name: 'drops input object default containing non-member enum literal',
    sdl: `
      enum Color { RED GREEN }
      input Box { color: Color ok: Color }
      type Query {
        f(arg: Box = { color: B10, ok: RED }): Int
      }
    `,
  },
  {
    name: 'drops enum default from string literal',
    sdl: `
      enum Color { RED GREEN }
      type Query {
        f(arg: Color = "RED"): Int
      }
    `,
  },
  {
    name: 'coerces directive usage string literal to enum member',
    sdl: `
      enum Color { RED GREEN }
      directive @fuzz(color: Color) on FIELD_DEFINITION
      type Query {
        f: Int @fuzz(color: "RED")
      }
    `,
  },
];

const throwingSnippets: Array<{ message: string; name: string; sdl: string }> = [
  {
    name: 'throws for directive usage with non-member enum literal',
    message: 'Enum "Color" cannot represent value: "B10"',
    sdl: `
      enum Color { RED GREEN }
      directive @fuzz(color: Color) on FIELD_DEFINITION
      type Query {
        f: Int @fuzz(color: B10)
      }
    `,
  },
  {
    name: 'throws for directive usage list containing non-member enum literal',
    message: 'Enum "Color" cannot represent value: "B10"',
    sdl: `
      enum Color { RED GREEN }
      directive @fuzz(colors: [Color]) on FIELD_DEFINITION
      type Query {
        f: Int @fuzz(colors: [RED, B10])
      }
    `,
  },
  {
    name: 'throws for directive usage input object containing non-member enum literal',
    message: 'Enum "Color" cannot represent value: "B10"',
    sdl: `
      enum Color { RED GREEN }
      input Box { color: Color ok: Color }
      directive @fuzz(box: Box) on FIELD_DEFINITION
      type Query {
        f: Int @fuzz(box: { color: B10, ok: RED })
      }
    `,
  },
];

describe('printSortedSdl', () => {
  test.each(snippets)('matches reference pipeline: $name', ({ sdl }) => {
    const document = parse(sdl);
    expect(normalize(printSortedSdl(document))).toBe(normalize(referencePipeline(document)));
  });

  test.each(throwingSnippets)('matches reference throw: $name', ({ message, sdl }) => {
    const document = parse(sdl);
    expect(() => referencePipeline(document)).toThrow(message);
    expect(() => printSortedSdl(document)).toThrow(message);
  });

  test('matches the benchmark golden SDL', () => {
    const scenarioDir = join(process.cwd(), 'bench', 'scenario');
    const subgraphs: Array<Subgraph> = readdirSync(scenarioDir)
      .filter((fileName) => fileName !== 'manifest.json' && fileName.endsWith('.graphql'))
      .sort()
      .map((fileName) => ({
        definitions: parse(readFileSync(join(scenarioDir, fileName), 'utf8')),
        name: fileName.replace(/\.graphql$/, ''),
        url: '',
      }));
    const result = federateSubgraphs({ subgraphs });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(normalize(printSortedSdl(result.federatedGraphAST))).toBe(
      normalize(readFileSync(join(process.cwd(), 'bench', 'golden.graphql'), 'utf8')),
    );
  });
});
