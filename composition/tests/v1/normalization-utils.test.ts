import { describe, expect, test } from 'vitest';
import {
  getNormalizedFieldSet,
  invalidCacheTagPlaceholderErrorMessage,
  parse,
  parseCacheTagFormat,
  invalidCacheTagBraceErrorMessage,
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
    expect(parseCacheTagFormat('products', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([]);
  });

  test('that a placeholder is parsed into its namespace and reference', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.searchKey}', errorMessages)).toStrictEqual([
      { namespace: 'args', reference: 'searchKey' },
    ]);
    expect(errorMessages).toStrictEqual([]);
  });

  test('that whitespace surrounding a placeholder is tolerated', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{   $args.searchKey        }', errorMessages)).toStrictEqual([
      { namespace: 'args', reference: 'searchKey' },
    ]);
    expect(errorMessages).toStrictEqual([]);
  });

  test('that a period-delimited reference is preserved as a path', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.filter.category}', errorMessages)).toStrictEqual([
      { namespace: 'args', reference: 'filter.category' },
    ]);
    expect(errorMessages).toStrictEqual([]);
  });

  test('that every placeholder of a format is parsed in order', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('{$args.a}-{$args.b}-{$args.c}', errorMessages)).toStrictEqual([
      { namespace: 'args', reference: 'a' },
      { namespace: 'args', reference: 'b' },
      { namespace: 'args', reference: 'c' },
    ]);
    expect(errorMessages).toStrictEqual([]);
  });

  test('that the namespace is returned verbatim rather than validated', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$request.id}', errorMessages)).toStrictEqual([
      { namespace: 'request', reference: 'id' },
    ]);
    expect(errorMessages).toStrictEqual([]);
  });

  test('that a placeholder without a "$" sigil is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{args.searchKey}', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('args.searchKey')]);
  });

  test('that a placeholder without a reference is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args}', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$args')]);
  });

  test('that an empty placeholder is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{}', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('')]);
  });

  test('that a placeholder with an empty path segment is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.searchKey.}', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$args.searchKey.')]);
  });

  test('that an unclosed placeholder is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.searchKey', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagBraceErrorMessage('products-{$args.searchKey')]);
  });

  test('that a stray closing brace is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products}', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagBraceErrorMessage('products}')]);
  });

  test('that a valid placeholder is still parsed alongside a malformed one', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('{$args.a}-{args.b}', errorMessages)).toStrictEqual([
      { namespace: 'args', reference: 'a' },
    ]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('args.b')]);
  });

  test('that a malformed placeholder and a brace outside a placeholder are both reported', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('{args.a}-{', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([
      invalidCacheTagPlaceholderErrorMessage('args.a'),
      invalidCacheTagBraceErrorMessage('{args.a}-{'),
    ]);
  });

  /* Whitespace is tolerated only around a placeholder as a whole; the reference itself must be a
   * period-delimited path of GraphQL Names, so interior whitespace does not form a placeholder.
   */
  test('that whitespace surrounding the period is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{ $args . name }', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage(' $args . name ')]);
  });

  test('that whitespace between the sigil and the namespace is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$ args.name}', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$ args.name')]);
  });

  test('that consecutive periods are rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args..name}', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$args..name')]);
  });

  test('that a namespace beginning with a digit is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$0args.name}', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$0args.name')]);
  });

  test('that a path segment beginning with a digit is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.0name}', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$args.0name')]);
  });

  test('that a character outside a GraphQL Name is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.na-me}', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$args.na-me')]);
  });

  // The placeholder is anchored, so a valid prefix cannot carry a trailing remainder through.
  test('that text trailing an otherwise valid placeholder is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$args.name extra}', errorMessages)).toStrictEqual([]);
    expect(errorMessages).toStrictEqual([invalidCacheTagPlaceholderErrorMessage('$args.name extra')]);
  });

  test('that a leading underscore is a valid namespace and path segment', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{$_args._name}', errorMessages)).toStrictEqual([
      { namespace: '_args', reference: '_name' },
    ]);
    expect(errorMessages).toStrictEqual([]);
  });

  test('that a newline surrounding a placeholder is tolerated', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('products-{\n$args.name\n}', errorMessages)).toStrictEqual([
      { namespace: 'args', reference: 'name' },
    ]);
    expect(errorMessages).toStrictEqual([]);
  });

  test('that a placeholder wrapped in a second pair of braces is rejected', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('{{$args.name}}', errorMessages)).toStrictEqual([
      { namespace: 'args', reference: 'name' },
    ]);
    expect(errorMessages).toStrictEqual([invalidCacheTagBraceErrorMessage('{{$args.name}}')]);
  });

  test('that an identical placeholder repeated in a format is parsed each time', () => {
    const errorMessages: Array<string> = [];
    expect(parseCacheTagFormat('{$args.a}-{$args.a}', errorMessages)).toStrictEqual([
      { namespace: 'args', reference: 'a' },
      { namespace: 'args', reference: 'a' },
    ]);
    expect(errorMessages).toStrictEqual([]);
  });

  test('that messages are appended to those already provided', () => {
    const errorMessages: Array<string> = ['existing'];
    parseCacheTagFormat('products-{}', errorMessages);
    expect(errorMessages).toStrictEqual(['existing', invalidCacheTagPlaceholderErrorMessage('')]);
  });
});
