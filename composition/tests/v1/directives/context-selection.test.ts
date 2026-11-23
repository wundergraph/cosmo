import { createSubgraph } from '../../utils/utils';

import { federateSubgraphs, normalizeSubgraphFromString } from '../../../src';

import { buildSchema, stripIgnoredCharacters } from 'graphql';
import { describe, expect, test } from 'vitest';
import { collectContexts } from '../../../src/v1/normalization/context';

function collect(selection: string) {
  return collectContexts(
    buildSchema(`
    directive @key(fields: String!) on OBJECT
    directive @context(name: String!) repeatable on OBJECT | INTERFACE | UNION
    directive @fromContext(field: String!) on ARGUMENT_DEFINITION
    type Query { accounts: [Account!]! }
    interface Account @context(name: "account") { id: ID! }
    type Member implements Account { id: ID!, plan: String }
    type Team implements Account { id: ID!, tier: String }
    type Wallet @key(fields: "id") { id: ID!, quote(plan: String @fromContext(field: "${selection}")): String }
  `),
  );
}

describe('context selection on an interface', () => {
  test('records the field selected for each runtime type', () => {
    const result = collect('$account ... on Member { plan } ... on Team { tier }');
    expect(result.providers[0].concreteTypeNames).toEqual(['Member', 'Team']);
    expect([...result.referenced].sort()).toEqual(['Member.plan', 'Team.tier']);
  });
  test('allows unmatched runtime types for a nullable contextual argument', () => {
    expect([...collect('$account ... on Member { plan }').referenced]).toEqual(['Member.plan']);
  });
  test('rejects overlapping branches', () => {
    expect(() => collect('$account ... on Member { plan } ... on Member { plan }')).toThrow('one field for Member');
  });
});

test('rejects an implementation-only contextual argument on an interface field', () => {
  const sdlString = `
    interface Quoted { quote: String }
    type Wallet implements Quoted @key(fields: "id") {
      id: ID!
      quote(plan: String @fromContext(field: "$member { plan }")): String
    }
    type Member @context(name: "member") { plan: String, wallet: Wallet }
    type Query { member: Member }
  `;
  const result = normalizeSubgraphFromString({ sdlString });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.errors[0].message).toContain('Wallet.quote(plan:');
});

test('serializes an interface binding in a v1 router config', () => {
  const sdlString = `
    type Query { members: [Member!]! }
    interface Account @context(name: "account") { locale: String! }
    type Member implements Account { locale: String!, wallet: Wallet! }
    type Wallet @key(fields: "id") {
      id: ID!
      quote(locale: String @fromContext(field: "$account { locale }")): String
    }`;
  const result = normalizeSubgraphFromString({ sdlString, version: '1' });
  expect(result.success).toBe(true);
  if (!result.success) throw result.errors[0];
  expect(result.configurationDataByTypeName.get('Account')?.contextProviders).toEqual([
    { contextName: 'account', typeName: 'Account', concreteTypeNames: ['Member'] },
  ]);
  expect(result.configurationDataByTypeName.get('Wallet')?.contextArguments?.[0]).toMatchObject({
    contextName: 'account',
    typeName: 'Wallet',
    fieldName: 'quote',
    argumentName: 'locale',
    argumentType: 'String',
  });
  expect(result.warnings).toHaveLength(0);
});

test.each([
  ['query', 'Query'],
  ['mutation', 'Mutation'],
  ['subscription', 'Subscription'],
])('uses the federated %s root name for context metadata', (operation, root) => {
  const sdlString = `
    schema { ${operation === 'query' ? '' : 'query: Query'} ${operation}: Entry }
    ${operation === 'query' ? '' : 'type Query { ping: String }'}
    type Entry @context(name: "root") { id: ID! wallet: Wallet }
    type Wallet @key(fields: "id") {
      id: ID!
      quote(scope: ID @fromContext(field: "$root ... on Entry { wallet { id } }")): String
    }`;
  const result = normalizeSubgraphFromString({ sdlString, version: '1' });
  if (!result.success) throw result.errors[0];
  expect(result.configurationDataByTypeName.get(root)?.contextProviders).toEqual([
    { contextName: 'root', typeName: root, concreteTypeNames: [root] },
  ]);
  expect(result.configurationDataByTypeName.has('Entry')).toBe(false);
  const selection = result.configurationDataByTypeName.get('Wallet')?.contextArguments?.[0].contextSelection;
  expect(selection).toContain(`... on ${root} {`);

  const composed = federateSubgraphs({ subgraphs: [createSubgraph('wallets', sdlString)], version: '1' });
  if (!composed.success) throw composed.errors[0];
});

test('omits coerced operation-root defaults and preserves other interface providers', () => {
  const sdl = `
    type Query { source: Source! }
    input Options { ids: [ID!]! score: Float = 2.5 }
    type Mutation implements Source @context(name:"owner") {
      wallet(opts:Options = {ids:["1"]} @inaccessible): Wallet
    }
    interface Source @context(name:"owner") { wallet(opts:Options @inaccessible): Wallet }
    type Member implements Source { wallet(opts:Options @inaccessible): Wallet }
    type Wallet @key(fields:"id") { id:ID! quote(v:ID @fromContext(field:"$owner {wallet(opts:{score:2.50,ids:1}) {id}}")):ID }
  `;
  const result = normalizeSubgraphFromString({ sdlString: sdl, version: '1' });
  if (!result.success) throw result.errors[0];
  const [binding] = result.configurationDataByTypeName.get('Wallet')!.contextArguments!;
  expect(stripIgnoredCharacters(binding.contextSelection)).toBe(
    '{...on Mutation{wallet{id}}...on Source{wallet(opts:{score:2.50 ids:1}){id}}}',
  );
  const federation = federateSubgraphs({ subgraphs: [createSubgraph('accounts', sdl)], version: '1' });
  if (!federation.success) throw federation.errors[0];
});

test('validates an interface introduced by another subgraph', () => {
  const interfaceGraph = createSubgraph(
    'catalog',
    `
    interface Quoted { quote: String }
    type Wallet implements Quoted @key(fields: "id") { id: ID! quote: String @shareable }
    type Query { wallet: Wallet }
  `,
  );
  const consumerGraph = createSubgraph(
    'pricing',
    `
    type Query { member: Member }
    type Member @context(name: "account") { plan: String wallet: Wallet }
    type Wallet @key(fields: "id") {
      id: ID!
      quote(plan: String @fromContext(field: "$account { plan }")): String @shareable
    }
  `,
  );
  const result = federateSubgraphs({ subgraphs: [interfaceGraph, consumerGraph], version: '1' });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.errors.map((e) => e.message).join(' ')).toContain('Wallet.quote(plan:');
});

describe('context selection types and field arguments', () => {
  function normalize(selection: string, argumentType: string) {
    return normalizeSubgraphFromString({
      sdlString: `
      type Query { member: Member }
      type Member @context(name: "account") {
        plans: [String!]!
        profiles: [Profile!]!
        planFor(paid: Boolean!, rules: [Rule!]): String!
        wallet: Wallet
      }
      input Rule { active: Boolean! }
      type Profile { plan: String! }
      type Wallet @key(fields: "id") {
        id: ID!
        quote(plan: ${argumentType} @fromContext(field: ${JSON.stringify('$account { ' + selection + ' }')})): String
      }
    `,
    });
  }

  test.each([
    ['__typename', 'String'],
    ['planFor(paid: true, rules: [{active: false}])', 'String'],
    ['plans', '[String]'],
    ['profiles { plan }', '[String]'],
  ])('accepts %s for %s', (selection, type) => {
    const result = normalize(selection, type);
    if (!result.success) throw result.errors[0];
    expect(result.configurationDataByTypeName.get('Wallet')?.contextArguments).toHaveLength(1);
  });

  test.each([
    ['plans', '[String!]'],
    ['profiles { plan }', '[String!]'],
    ['planFor', 'String'],
    ['planFor(paid: 123)', 'String'],
    ['planFor(paid: true, extra: 1)', 'String'],
    ['planFor(paid: true, paid: false)', 'String'],
    ['planFor(paid: true, rules: [{active: $client}])', 'String'],
    ['planFor(paid: true, rules: [{unknown: 1}])', 'String'],
    ['planFor(paid: true, rules: [{active: false, active: true}])', 'String'],
  ])('rejects %s for %s', (selection, type) => {
    const result = normalize(selection, type);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0].message).toContain('@fromContext on Wallet.quote');
  });
});
