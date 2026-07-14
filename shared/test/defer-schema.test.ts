import { buildSchema } from 'graphql';
import { describe, expect, it } from 'vitest';

import { withDeferDirective } from '../src/playground/defer-schema';

describe('withDeferDirective', () => {
  it('adds the router-compatible defer directive signature', () => {
    const original = buildSchema('type Query { hello: String! }');
    const schema = withDeferDirective(original);
    const directive = schema.getDirective('defer');

    expect(directive).toBeDefined();
    expect(directive?.locations).toEqual(['FRAGMENT_SPREAD', 'INLINE_FRAGMENT']);
    expect(
      directive?.args.map((argument) => ({
        name: argument.name,
        type: argument.type.toString(),
        defaultValue: argument.defaultValue,
      })),
    ).toEqual([
      { name: 'label', type: 'String', defaultValue: undefined },
      { name: 'if', type: 'Boolean!', defaultValue: true },
    ]);
    expect(original.getDirective('defer')).toBeUndefined();
  });

  it('is idempotent when the schema already defines defer', () => {
    const schema = withDeferDirective(buildSchema('type Query { hello: String! }'));

    expect(withDeferDirective(schema)).toBe(schema);
    expect(schema.getDirectives().filter((directive) => directive.name === 'defer')).toHaveLength(1);
  });

  it('leaves an existing server-provided defer definition unchanged', () => {
    const schema = buildSchema(`
      directive @defer(custom: String) on INLINE_FRAGMENT
      type Query { hello: String! }
    `);

    expect(withDeferDirective(schema)).toBe(schema);
    expect(schema.getDirective('defer')?.args.map((argument) => argument.name)).toEqual(['custom']);
  });
});
