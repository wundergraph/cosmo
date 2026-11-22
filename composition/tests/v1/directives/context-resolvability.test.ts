import { describe, expect, test, vi } from 'vitest';
import { validateContextPaths } from '../../../src/resolvability-graph/context-resolvability';
import { FederationFactory } from '../../../src/v1/federation/federation-factory';
import { federateSubgraphs } from '../../../src';
import { createSubgraph } from '../../utils/utils';

function compose(...schemas: string[]) {
  return federateSubgraphs({
    subgraphs: schemas.map((sdl, i) => createSubgraph(`subgraph${i + 1}`, sdl)),
  });
}

const binding = 'quote(plan: ID @fromContext(field: "$account { id }")): String';
const wallet = 'type Wallet @key(fields: "id") { id: ID! ' + binding + ' }';
const member = 'type Member @context(name: "account") { id: ID!, wallet: Wallet }';

describe('context resolvability', () => {
  test('reports a root path that reaches a resolver without its context', () => {
    const result = compose('type Query { member: Member, wallet: Wallet }' + member + wallet);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.map((e) => e.message).join()).toContain('Query.wallet.quote');
  });

  test('allows a context provided on all paths, including paths through a cycle', () => {
    expect(
      compose('type Query { member: Member }' + member + wallet.replace('id: ID!', 'next: Wallet id: ID!')).success,
    ).toBe(true);
  });

  test('requires a strict ancestor even when the receiver sets the same context', () => {
    const result = compose('type Query { wallet: Wallet }' + wallet.replace('@key', '@context(name: "account") @key'));
    expect(result.success).toBe(false);
  });

  test('checks each concrete type of an abstract ancestor', () => {
    const schema =
      'type Query { accounts: [Account] } interface Account { id: ID! wallet: Wallet }' +
      'type Member implements Account @context(name: "account") { id: ID! wallet: Wallet }' +
      'type Team implements Account { id: ID! wallet: Wallet }' +
      wallet;
    const result = compose(schema);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.map((e) => e.message).join()).toContain('... on Team');
    expect(
      compose(schema.replace('interface Account {', 'interface Account @context(name: "account") {')).success,
    ).toBe(true);
  });

  test.each(['@shareable', '@override(from: "subgraph1")'])('allows an alternative resolver using %s', (directive) => {
    const base =
      'type Query { member: Member, wallet: Wallet }' +
      member +
      wallet.replace(binding, binding + (directive === '@shareable' ? ' @shareable' : ''));
    expect(compose(base, 'type Wallet @key(fields: "id") { id: ID! quote: String ' + directive + ' }').success).toBe(
      true,
    );
  });

  test('scopes contexts of the same name to their defining subgraph', () => {
    const result = compose(
      'type Query { other: Other } type Other @context(name: "account") { id: ID! wallet: Wallet } type Wallet @key(fields: "id", resolvable: false) { id: ID! }',
      'type Query { member: Member }' + member + wallet,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.map((e) => e.message).join()).toContain('Query.other.wallet.quote');
  });

  test('ignores an inaccessible entry point', () => {
    expect(compose('type Query { member: Member, wallet: Wallet @inaccessible }' + member + wallet).success).toBe(true);
  });

  test('an alternative resolver must also be able to resolve the selected descendants', () => {
    const base =
      'type Query { member: Member, wallet: Wallet }' +
      member +
      wallet.replace(binding, binding.replace(': String', ': Quote @shareable')) +
      'type Quote { premium: String }';
    const result = compose(
      base,
      'type Wallet @key(fields: "id") { id: ID!, quote: Quote @shareable } type Quote { basic: String }',
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.map((e) => e.message).join()).toContain('Query.wallet.quote.premium');
  });

  test('an unconditional resolver with no usable key is not an alternative', () => {
    const base =
      'type Query { member: Member, wallet: Wallet }' + member + wallet.replace(binding, binding + ' @shareable');
    const result = compose(
      base,
      'type Wallet @key(fields: "id", resolvable: false) { id: ID!, quote: String @shareable }',
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.map((e) => e.message).join()).toContain('Query.wallet.quote');
  });

  test('uses a public alternative only when its @requires fields are reachable on the current path', () => {
    const entry = `
      type Query { covered: Account, bare: Wallet }
      type Account @context(name: "account") { id: ID!, wallet: Wallet }
      type Wallet @key(fields: "id") {
        id: ID!, quote(value: ID @fromContext(field: "$account { id }")): String @shareable
      }`;
    const fallback = `
      type Wallet @key(fields: "id") {
        id: ID!, quote: String @shareable @requires(fields: "secret"), secret: String @external
      }`;
    const unreachable = 'type Wallet @key(fields: "token") { token: ID! @inaccessible, secret: String @inaccessible }';
    const reachable = 'type Wallet @key(fields: "id") { id: ID!, secret: String @inaccessible }';

    for (const subgraphs of [
      [entry, fallback, unreachable],
      [fallback, unreachable, entry],
    ]) {
      const result = compose(...subgraphs);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.errors.map((err) => err.message).join()).toContain('Query.bare.quote');
    }
    expect(compose(entry, fallback, reachable).success).toBe(true);
    expect(compose(entry.replace('bare: Wallet', ''), fallback, unreachable).success).toBe(true);
  });

  test('@provides supplies an alternative on its own path only', () => {
    const base = 'type Query { member: Member }' + member + wallet.replace(binding, binding + ' @shareable');
    const external = 'type Wallet @key(fields: "id", resolvable: false) { id: ID!, quote: String @external }';
    const providing = 'provided: Wallet @provides(fields: "quote")';
    expect(compose(base, 'type Query { ' + providing + ' }' + external).success).toBe(true);
    const result = compose(base, 'type Query { ' + providing + ' bare: Wallet }' + external);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.map((e) => e.message).join()).toContain('Query.bare.quote');
  });

  test('an overridden unconditional resolver cannot satisfy the field', () => {
    const result = compose(
      'type Query { wallet: Wallet } type Wallet @key(fields: "id") { id: ID! quote: String }',
      'type Query { member: Member }' + member + wallet.replace(binding, binding + ' @override(from: "subgraph1")'),
    );
    expect(result.success).toBe(false);
  });

  test('checks the contextual arguments of an inaccessible selection on each ancestor path', () => {
    const types = `
      type Account @context(name: "account") { id: ID!, member: Member! }
      interface Profile @context(name: "profile") { wallet: Wallet! }
      type Member implements Profile @key(fields: "id") {
        id: ID! wallet: Wallet!
        hidden(a: ID @fromContext(field: "$account { id }")): String @inaccessible
      }
      type Wallet @key(fields: "id") {
        id: ID! quote(a: String @fromContext(field: "$profile { ... on Member { hidden } }")): String!
      }
    `;
    expect(compose('type Query { account: Account! }' + types).success).toBe(true);
    const result = compose('type Query { account: Account! member: Member! }' + types);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.map((e) => e.message).join()).toContain('Query.member.wallet.quote');
  });

  test('a context selection must be fetchable using a reachable entity key', () => {
    const source =
      'type Query { account: Account } type Account @key(fields: "id") { id: ID! wallet: Wallet } type Wallet @key(fields: "id") { id: ID! }';
    const owner = `
      type Account @key(fields: "token") @context(name: "account") {
        token: ID! @inaccessible locale: String! @inaccessible
      }
      type Wallet @key(fields: "id") { id: ID! quote(a: String @fromContext(field: "$account { locale }")): String }
    `;
    expect(compose(source, owner.replaceAll('token', 'id').replace('id: ID! @inaccessible', 'id: ID!')).success).toBe(
      true,
    );
    const result = compose(source, owner);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.map((e) => e.message).join()).toContain('Query.account.wallet.quote');
  });

  test('checks hidden contextual prerequisites of a public @requires resolver', () => {
    const types = member + wallet.replace(binding, binding.replace('quote', 'hidden') + ' @inaccessible');
    const dependent =
      'type Wallet @key(fields: "id") { id: ID!, hidden: String @external, value: String @requires(fields: "hidden") }';
    expect(compose('type Query { member: Member }' + types, dependent).success).toBe(true);
    const result = compose('type Query { member: Member wallet: Wallet }' + types, dependent);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.map((e) => e.message).join()).toContain('Query.wallet.value');
  });

  test('checks each projection of a context separately and honors @provides for a hidden field', () => {
    const source = `
      type Query { account: Account @provides(fields: "locale") }
      type Account @key(fields: "id") {
        id: ID! locale: String! @external wallet: Wallet
      }
      type Wallet @key(fields: "id") { id: ID! }
    `;
    const owner = `
      type Account @key(fields: "token") @context(name: "account") {
        token: ID! @inaccessible id: ID! @external locale: String! @inaccessible
      }
      type Wallet @key(fields: "id") {
        id: ID!
        name(a: ID @fromContext(field: "$account { id }")): String
        quote(a: String @fromContext(field: "$account { locale }")): String
      }
    `;
    expect(compose(source, owner).success).toBe(true);
    const result = compose(
      source.replace('account: Account @provides', 'bare: Account account: Account @provides'),
      owner,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = result.errors.map((e) => e.message).join();
      expect(errors).toContain('Query.bare.wallet.quote');
      expect(errors).not.toContain('Wallet.name');
    }
  });

  test.for(['direct', 'nested', 'nested with a shadowing context provider'])(
    'reuses verified requirements in a %s shared dependency graph',
    (mode, { onTestFinished }) => {
      const fieldCount = 18;
      const nested = mode !== 'direct';
      const shadowing = mode === 'nested with a shadowing context provider';
      // Every computed field requires its two predecessors from different subgraphs.
      const schemas = Array.from({ length: 3 }, (_, owner) => {
        const fields = ['id: ID!'];
        if (nested) fields.push('previous: Stat @external');
        const external = new Set<string>();
        for (let i = owner; i < fieldCount; i += 3) {
          const dependencies = i < 2 ? [] : [`v${i - 1}`, `v${i - 2}`];
          for (const dependency of dependencies) external.add(dependency);
          const selection = nested ? `previous { ${dependencies.join(' ')} }` : dependencies.join(' ');
          fields.push(`v${i}: Int` + (dependencies.length ? ` @requires(fields: "${selection}")` : ''));
        }
        for (const field of external) fields.push(`${field}: Int @external`);
        if (owner === 0) fields.push('quote(a: ID @fromContext(field: "$account { id }")): String');
        const entry =
          owner === 0
            ? 'type Query { account: Account } type Account @context(name: "account") { id: ID! stat: Stat }'
            : '';
        const provider = owner === 0 && shadowing;
        if (provider) fields.push('leaf: Leaf');
        const leaf = provider
          ? 'type Leaf @key(fields: "id") { id: ID! value(a: ID @fromContext(field: "$stat { id }")): Int }'
          : '';
        return (
          entry +
          leaf +
          `type Stat ${provider ? '@context(name: "stat")' : ''} @key(fields: "id") { ${fields.join(' ')} }`
        );
      });
      if (nested) schemas.push('type Stat @key(fields: "id") { id: ID! previous: Stat }');
      // Recheck the composed graph so the count covers only context validation.
      const composition = vi.spyOn(FederationFactory.prototype, 'buildFederationResult');
      onTestFinished(() => composition.mockRestore());
      expect(compose(...schemas).success).toBe(true);
      const { internalGraph, internalSubgraphBySubgraphName, concreteTypeNamesByAbstractTypeName } = composition.mock
        .contexts[0] as FederationFactory;
      const edges = internalGraph.nodeByNodeName.get('subgraph1.Stat')!.headToTailEdges;
      const edgeLookups = vi.spyOn(edges, 'get');
      onTestFinished(() => edgeLookups.mockRestore());
      expect(
        validateContextPaths(internalGraph, internalSubgraphBySubgraphName, concreteTypeNamesByAbstractTypeName),
      ).toEqual([]);
      expect(edgeLookups).toHaveBeenCalled();
      // A recursive provider can change the bindings in scope. Shared prerequisites must still
      // be reused across the dependency graph.
      expect(edgeLookups.mock.calls.length).toBeLessThan(shadowing ? fieldCount ** 2 * 2 : fieldCount * 10);
    },
  );

  test('resolves the same projection through distinct strict ancestors', () => {
    const schema = `
      type Query { outer: Outer }
      type Outer @context(name: "outer") { account: Account, wallet: Wallet }
      type Account @context(name: "account") { id: ID, nested: Nested }
      type Nested @context(name: "account") @key(fields: "key") {
        key: ID!
        id(fromParent: ID @fromContext(field: "$account { id }")): ID
        leaf: Leaf
      }
      type Leaf @key(fields: "key") {
        key: ID!
        value(fromParent: ID @fromContext(field: "$account { id }")): ID
      }
      type Wallet @key(fields: "key") {
        key: ID!
        quote(value: ID @fromContext(field: "$outer { account { nested { leaf { value } } } }")): Int
      }
    `;
    expect(compose(schema).success).toBe(true);
  });

  test('uses an independently resolvable binding on the same provider', () => {
    const entry = 'type Query { account: Account } type Account @context(name: "account") { id: ID, wallet: Wallet }';
    const id = 'id(fromParent: ID @fromContext(field: "$account { id }")): ID';
    const quote = 'quote(value: ID @fromContext(field: "$account { wallet { id } }")): Int';
    for (const fields of [
      [quote, id],
      [id, quote],
    ]) {
      expect(compose(entry + `type Wallet @key(fields: "key") { key: ID!, ${fields.join(' ')} }`).success).toBe(true);
    }
  });

  test('rejects a projection that depends on itself through a recursive provider', () => {
    const result = compose(`
      type Query { account: Account }
      type Account @context(name: "account") { next: Account, wallet: Wallet }
      type Wallet @key(fields: "key") {
        key: ID!
        quote(value: Int @fromContext(field: "$account { next { wallet { quote } } }")): Int
      }
    `);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.map((err) => err.message).join()).toContain('Query.account.wallet.quote');
  });

  test('resolves independent nested projections of the same provider', () => {
    const names = Array.from({ length: 14 }, (_, i) => `field${i}`);
    const graph = `
      type Query { account: Account! }
      type Account @context(name: "account") { profile: Profile! wallet: Wallet! }
      type Profile { ${names.map((name) => `${name}: String!`).join(' ')} }
      type Wallet @key(fields: "id") {
        id: ID!
        ${names.map((name) => `${name}(a: String @fromContext(field: "$account { profile { ${name} } }")): String`).join(' ')}
      }
    `;
    expect(compose(graph).success).toBe(true);
  });
});
