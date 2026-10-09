import { describe, expect, test } from 'vitest';
import {
  getNormalizedFieldSet,
  invalidCacheTagBraceErrorMessage,
  invalidCacheTagPlaceholderErrorMessage,
  doesFieldSetSelectLeafPath,
  parse,
  parseCacheTagFormat,
} from '../../src';

describe('Utils tests', () => {
  test('that a deeply nested FieldSet is normalized', () => {
    expect(
      getNormalizedFieldSet(
        parse(`{
      field { one two, three {
      innerField {
      
      innerField2 innerField1
      
      
      },},four}
      
    }
    
    `),
      ),
    ).toStrictEqual(`field { four one three { innerField { innerField1 innerField2 } } two }`);
  });
});

describe('format parsing tests', () => {
  test('that a format without placeholders yields no placeholders', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products', errorMessages)).toStrictEqual({
      canonicalFormat: 'products',
      placeholders: [],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  test('that a placeholder is parsed into its namespace and reference', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.searchKey}', errorMessages)).toStrictEqual({
      canonicalFormat: 'products-{$args.searchKey}',
      placeholders: [{ namespace: 'args', reference: 'searchKey' }],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  test('that whitespace surrounding a placeholder is tolerated', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{   $args.searchKey        }', errorMessages)).toStrictEqual({
      canonicalFormat: 'products-{$args.searchKey}',
      placeholders: [{ namespace: 'args', reference: 'searchKey' }],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  test('that a period-delimited reference is preserved as a path', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.filter.category}', errorMessages)).toStrictEqual({
      canonicalFormat: 'products-{$args.filter.category}',
      placeholders: [{ namespace: 'args', reference: 'filter.category' }],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  test('that every placeholder of a format is parsed in order', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('{$args.a}-{$args.b}-{$args.c}', errorMessages)).toStrictEqual({
      canonicalFormat: '{$args.a}-{$args.b}-{$args.c}',
      placeholders: [
        { namespace: 'args', reference: 'a' },
        { namespace: 'args', reference: 'b' },
        { namespace: 'args', reference: 'c' },
      ],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  test('that the namespace is returned verbatim rather than validated', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$request.id}', errorMessages)).toStrictEqual({
      canonicalFormat: 'products-{$request.id}',
      placeholders: [{ namespace: 'request', reference: 'id' }],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  test('that a placeholder without a "$" sigil is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{args.searchKey}', errorMessages).placeholders).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('args.searchKey')]);
  });

  test('that a placeholder without a reference is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args}', errorMessages).placeholders).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$args')]);
  });

  test('that an empty placeholder is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{}', errorMessages).placeholders).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('')]);
  });

  test('that a placeholder with an empty path segment is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.searchKey.}', errorMessages).placeholders).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$args.searchKey.')]);
  });

  test('that an unclosed placeholder is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.searchKey', errorMessages).placeholders).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagBraceErrorMessage('products-{$args.searchKey')]);
  });

  test('that a stray closing brace is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products}', errorMessages).placeholders).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagBraceErrorMessage('products}')]);
  });

  test('that a valid placeholder is still parsed alongside a malformed one', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('{$args.a}-{args.b}', errorMessages).placeholders).toStrictEqual([
      { namespace: 'args', reference: 'a' },
    ]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('args.b')]);
  });

  test('that a malformed placeholder and a brace outside a placeholder are both reported', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('{args.a}-{', errorMessages).placeholders).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([
      invalidCacheTagPlaceholderErrorMessage('args.a'),
      invalidCacheTagBraceErrorMessage('{args.a}-{'),
    ]);
  });

  test('that whitespace surrounding the period is tolerated', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{ $args . name }', errorMessages)).toStrictEqual({
      canonicalFormat: 'products-{$args.name}',
      placeholders: [{ namespace: 'args', reference: 'name' }],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  test('that whitespace upon one side of the period is tolerated', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('{$args .a}-{$args. b}', errorMessages)).toStrictEqual({
      canonicalFormat: '{$args.a}-{$args.b}',
      placeholders: [
        { namespace: 'args', reference: 'a' },
        { namespace: 'args', reference: 'b' },
      ],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  test('that a newline or tab surrounding the period is tolerated', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args\n.\tname}', errorMessages)).toStrictEqual({
      canonicalFormat: 'products-{$args.name}',
      placeholders: [{ namespace: 'args', reference: 'name' }],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  test('that whitespace surrounding each period of a path is removed from the reference', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.filter . nested\n.depth}', errorMessages)).toStrictEqual({
      canonicalFormat: 'products-{$args.filter.nested.depth}',
      placeholders: [{ namespace: 'args', reference: 'filter.nested.depth' }],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  test('that a spaced period without a following segment is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.name . }', errorMessages).placeholders).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$args.name . ')]);
  });

  test('that whitespace between the sigil and the namespace is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$ args.name}', errorMessages).placeholders).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$ args.name')]);
  });

  test('that consecutive periods are rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args..name}', errorMessages).placeholders).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$args..name')]);
  });

  test('that a namespace beginning with a digit is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$0args.name}', errorMessages).placeholders).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$0args.name')]);
  });

  test('that a path segment beginning with a digit is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.0name}', errorMessages).placeholders).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$args.0name')]);
  });

  test('that a character outside a GraphQL Name is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.na-me}', errorMessages).placeholders).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$args.na-me')]);
  });

  // The placeholder is anchored, so a valid prefix cannot carry a trailing remainder through.
  test('that text trailing an otherwise valid placeholder is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.name extra}', errorMessages).placeholders).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$args.name extra')]);
  });

  test('that a leading underscore is a valid namespace and path segment', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$_args._name}', errorMessages)).toStrictEqual({
      canonicalFormat: 'products-{$_args._name}',
      placeholders: [{ namespace: '_args', reference: '_name' }],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  test('that a newline surrounding a placeholder is tolerated', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{\n$args.name\n}', errorMessages)).toStrictEqual({
      canonicalFormat: 'products-{$args.name}',
      placeholders: [{ namespace: 'args', reference: 'name' }],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  test('that a placeholder wrapped in a second pair of braces is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('{{$args.name}}', errorMessages).placeholders).toStrictEqual([
      { namespace: 'args', reference: 'name' },
    ]);
    expect(errorMessages).toStrictEqual([invalidCacheTagBraceErrorMessage('{{$args.name}}')]);
  });

  test('that an identical placeholder repeated in a format is parsed each time', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('{$args.a}-{$args.a}', errorMessages)).toStrictEqual({
      canonicalFormat: '{$args.a}-{$args.a}',
      placeholders: [
        { namespace: 'args', reference: 'a' },
        { namespace: 'args', reference: 'a' },
      ],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  test('that text outside a placeholder is retained verbatim in the canonical format', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat(' tag  one-{ $args.id }\t', errorMessages)).toStrictEqual({
      canonicalFormat: ' tag  one-{$args.id}\t',
      placeholders: [{ namespace: 'args', reference: 'id' }],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  // JavaScript "\\s" matches Unicode whitespace, so it is removed rather than passed to the router.
  test('that Unicode whitespace within a placeholder is removed from the canonical format', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('{\u00a0$args\u2028.\u3000id\ufeff}', errorMessages)).toStrictEqual({
      canonicalFormat: '{$args.id}',
      placeholders: [{ namespace: 'args', reference: 'id' }],
    });
    expect(errorMessages).toStrictEqual([]);
  });

  test('that messages are appended to those already provided', () => {
    const errorMessages: Array<string> = ['existing'];
    parseCacheTagFormat('products-{}', errorMessages);
    expect(errorMessages).toStrictEqual(['existing', invalidCacheTagPlaceholderErrorMessage('')]);
  });
});

describe('leaf field path tests', () => {
  const documentNode = parse(`{ id organization { id } sku }`);

  test('that a path to a field without a selection set is selected', () => {
    expect(doesFieldSetSelectLeafPath(documentNode, ['id'])).toBe(true);
    expect(doesFieldSetSelectLeafPath(documentNode, ['organization', 'id'])).toBe(true);
    // A field that follows a nested selection set is not a child of that selection set.
    expect(doesFieldSetSelectLeafPath(documentNode, ['sku'])).toBe(true);
  });

  test('that a path to a field with a selection set is not selected', () => {
    expect(doesFieldSetSelectLeafPath(documentNode, ['organization'])).toBe(false);
  });

  test('that a path that the field set does not select is not selected', () => {
    expect(doesFieldSetSelectLeafPath(documentNode, ['name'])).toBe(false);
    expect(doesFieldSetSelectLeafPath(documentNode, ['organization', 'name'])).toBe(false);
    expect(doesFieldSetSelectLeafPath(documentNode, ['id', 'id'])).toBe(false);
    expect(doesFieldSetSelectLeafPath(parse(`{ organization { id } }`), ['id'])).toBe(false);
  });
});
