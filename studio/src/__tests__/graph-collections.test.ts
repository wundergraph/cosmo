import { describe, expect, it } from 'vitest';
import {
  bindTab,
  buildCollectionShareUrl,
  filterCollections,
  findTabForOperation,
  MAX_OPERATION_LENGTH,
  operationSaveError,
  parseTabBindings,
  pruneBindings,
  resolveDeepLinkedCollection,
  resolveDeepLinkedOperation,
  suggestOperationName,
  TabBindings,
  updateBindingHash,
} from '@/lib/graph-collections';

const binding = (operationId: string, loadedContentHash = 'h1') => ({
  collectionId: 'c1',
  operationId,
  loadedContentHash,
});

describe('tab bindings', () => {
  it('binds a tab to a saved operation', () => {
    const result = bindTab({}, 'tab-1', binding('op-1'));
    expect(result['tab-1'].operationId).toBe('op-1');
    expect(result['tab-1'].loadedContentHash).toBe('h1');
  });

  it('rebinds a tab when Save as creates a new operation', () => {
    const first = bindTab({}, 'tab-1', binding('op-1'));
    const second = bindTab(first, 'tab-1', binding('op-2'));

    expect(second['tab-1'].operationId).toBe('op-2');
    // Rebinding must replace, not accumulate: one tab edits one operation.
    expect(Object.keys(second)).toHaveLength(1);
  });

  it('does not mutate the bindings it is given', () => {
    const original = bindTab({}, 'tab-1', binding('op-1'));
    bindTab(original, 'tab-2', binding('op-2'));
    expect(Object.keys(original)).toEqual(['tab-1']);
  });

  it('prunes bindings whose tab has been closed', () => {
    const bindings: TabBindings = {
      'tab-1': binding('op-1'),
      'tab-2': binding('op-2'),
    };

    expect(Object.keys(pruneBindings(bindings, ['tab-1']))).toEqual(['tab-1']);
  });

  it('prunes everything when every tab is gone', () => {
    const bindings: TabBindings = { 'tab-1': binding('op-1') };
    expect(pruneBindings(bindings, [])).toEqual({});
  });

  it('finds the tab already editing an operation', () => {
    const bindings = bindTab({}, 'tab-7', binding('op-9'));
    expect(findTabForOperation(bindings, 'op-9')).toBe('tab-7');
    expect(findTabForOperation(bindings, 'op-none')).toBeUndefined();
  });

  it('advances the stored hash after a successful save', () => {
    const bindings = bindTab({}, 'tab-1', binding('op-1', 'h1'));
    const advanced = updateBindingHash(bindings, 'tab-1', 'h2');

    // The next save must send the hash the server just returned, or it would
    // conflict with itself.
    expect(advanced['tab-1'].loadedContentHash).toBe('h2');
    expect(advanced['tab-1'].operationId).toBe('op-1');
  });

  it('ignores a hash update for a tab that is no longer bound', () => {
    expect(updateBindingHash({}, 'tab-1', 'h2')).toEqual({});
  });

  describe('parsing persisted bindings', () => {
    it('round-trips a stored blob', () => {
      const bindings = bindTab({}, 'tab-1', binding('op-1'));
      expect(parseTabBindings(JSON.stringify(bindings))).toEqual(bindings);
    });

    it('returns empty for absent storage', () => {
      expect(parseTabBindings(null)).toEqual({});
    });

    it('returns empty rather than throwing on corrupt storage', () => {
      expect(parseTabBindings('{not json')).toEqual({});
    });

    it('drops entries that are not shaped like bindings', () => {
      const stored = JSON.stringify({
        'tab-good': binding('op-1'),
        'tab-bad': { nonsense: true },
        'tab-null': null,
      });

      expect(Object.keys(parseTabBindings(stored))).toEqual(['tab-good']);
    });

    it('returns empty when the stored value is not an object', () => {
      expect(parseTabBindings('"a string"')).toEqual({});
      expect(parseTabBindings('[1,2,3]')).toEqual({});
    });
  });
});

describe('deep link resolution', () => {
  const collections = [{ id: '11111111-1111-1111-1111-111111111111' }];

  it('reports none when no collection is requested', () => {
    expect(resolveDeepLinkedCollection(collections, undefined).status).toBe('none');
    expect(resolveDeepLinkedCollection(collections, '').status).toBe('none');
  });

  it('finds a requested collection the user can see', () => {
    const result = resolveDeepLinkedCollection(collections, '11111111-1111-1111-1111-111111111111');
    expect(result.status).toBe('found');
    expect(result.id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('reports unavailable for a collection outside the accessible set', () => {
    // Missing, wrong graph and not-permitted are deliberately indistinguishable.
    expect(resolveDeepLinkedCollection(collections, '22222222-2222-2222-2222-222222222222').status).toBe('unavailable');
  });

  it('reports unavailable for a malformed id rather than throwing', () => {
    expect(resolveDeepLinkedCollection(collections, 'not-a-uuid').status).toBe('unavailable');
  });

  it('reports unavailable when nothing is accessible at all', () => {
    expect(resolveDeepLinkedCollection([], '11111111-1111-1111-1111-111111111111').status).toBe('unavailable');
  });
});

describe('suggested operation name', () => {
  it('uses the name of a named operation', () => {
    expect(suggestOperationName(null, 'query GetCart { cart { id } }')).toBe('GetCart');
  });

  it('prefers the name GraphiQL reports, which respects the selected operation', () => {
    // A document with several operations: GraphiQL knows which one is active,
    // and the document order does not.
    const document = 'query First { a }\nquery Second { b }';
    expect(suggestOperationName('Second', document)).toBe('Second');
  });

  it('falls back to the first named operation when GraphiQL reports none', () => {
    expect(suggestOperationName(null, 'query First { a }\nquery Second { b }')).toBe('First');
  });

  it('names mutations and subscriptions too', () => {
    expect(suggestOperationName(null, 'mutation AddToCart { add { id } }')).toBe('AddToCart');
    expect(suggestOperationName(null, 'subscription OnCart { cart { id } }')).toBe('OnCart');
  });

  it('skips fragments and returns the operation', () => {
    const document = 'fragment CartBits on Cart { id }\nquery GetCart { cart { ...CartBits } }';
    expect(suggestOperationName(null, document)).toBe('GetCart');
  });

  it('returns empty for an anonymous operation', () => {
    expect(suggestOperationName(null, '{ cart { id } }')).toBe('');
  });

  it('returns empty for an unparseable document rather than throwing', () => {
    // Saving work in progress must not depend on a valid document.
    expect(suggestOperationName(null, 'query {{{')).toBe('');
  });

  it('returns empty for an empty document', () => {
    expect(suggestOperationName(null, '')).toBe('');
    expect(suggestOperationName(null, '   ')).toBe('');
  });

  it('ignores a blank name from GraphiQL', () => {
    expect(suggestOperationName('  ', 'query GetCart { cart { id } }')).toBe('GetCart');
  });
});

describe('collection share url', () => {
  it('builds a link addressing just the collection', () => {
    expect(
      buildCollectionShareUrl(
        'https://cosmo.wundergraph.com',
        '/acme/default/graph/production/playground',
        '123e4567-e89b-12d3-a456-426614174000',
      ),
    ).toBe(
      'https://cosmo.wundergraph.com/acme/default/graph/production/playground?collectionId=123e4567-e89b-12d3-a456-426614174000',
    );
  });

  it('includes the operation when one is given', () => {
    expect(
      buildCollectionShareUrl(
        'https://cosmo.wundergraph.com',
        '/acme/default/graph/production/playground',
        'c1',
        'op1',
      ),
    ).toBe('https://cosmo.wundergraph.com/acme/default/graph/production/playground?collectionId=c1&operationId=op1');
  });

  it('builds from origin and pathname only, so page params are never carried along', () => {
    // The playground URL can hold an entire compressed operation in
    // playgroundUrlState; none of that belongs in a collection link.
    const url = buildCollectionShareUrl('https://x.test', '/a/b/playground', 'c1');
    expect(url).toBe('https://x.test/a/b/playground?collectionId=c1');
  });
});

describe('deep linked operation', () => {
  const collections = [
    { id: 'c1', operations: [{ id: 'op1' }, { id: 'op2' }] },
    { id: 'c2', operations: [{ id: 'op3' }] },
  ];

  it('reports none when nothing is requested', () => {
    expect(resolveDeepLinkedOperation(collections, undefined).status).toBe('none');
    expect(resolveDeepLinkedOperation(collections, '').status).toBe('none');
  });

  it('finds an operation and the collection that owns it', () => {
    const result = resolveDeepLinkedOperation(collections, 'op3');
    expect(result).toEqual({ status: 'found', operationId: 'op3', collectionId: 'c2' });
  });

  it('reports unavailable for an operation outside the accessible set', () => {
    expect(resolveDeepLinkedOperation(collections, 'nope').status).toBe('unavailable');
  });

  it('reports unavailable when no collection is accessible', () => {
    expect(resolveDeepLinkedOperation([], 'op1').status).toBe('unavailable');
  });
});

describe('filtering collections', () => {
  const collections = [
    {
      id: 'c2',
      name: 'zebra',
      operations: [
        { id: 'o1', name: 'beta' },
        { id: 'o2', name: 'Alpha' },
      ],
    },
    { id: 'c1', name: 'Apple', operations: [{ id: 'o3', name: 'gamma' }] },
  ];

  it('leaves order alone, because the server returns these sorted', () => {
    // Re-sorting here would fight the server's ORDER BY lower(name).
    expect(filterCollections(collections, '').map((c) => c.name)).toEqual(['zebra', 'Apple']);
  });

  it('treats a blank term as no filter', () => {
    expect(filterCollections(collections, '   ')).toHaveLength(2);
  });

  it('keeps only operations matching the term', () => {
    const result = filterCollections(collections, 'alp');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('zebra');
    expect(result[0].operations.map((o) => o.name)).toEqual(['Alpha']);
  });

  it('keeps every operation when the collection name itself matches', () => {
    // Searching for a collection should show you what is in it, not an
    // empty collection whose operations happened not to match.
    const result = filterCollections(collections, 'zeb');
    expect(result).toHaveLength(1);
    expect(result[0].operations.map((o) => o.name)).toEqual(['beta', 'Alpha']);
  });

  it('drops collections with nothing matching', () => {
    expect(filterCollections(collections, 'nothing-here')).toEqual([]);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(filterCollections(collections, '  GAMMA ')).toHaveLength(1);
    expect(filterCollections(collections, '  GAMMA ')[0].name).toBe('Apple');
  });

  it('keeps an empty collection when its own name matches', () => {
    const withEmpty = [{ id: 'c3', name: 'Scratch', operations: [] }];
    expect(filterCollections(withEmpty, 'scr')).toHaveLength(1);
  });
});

describe('operation save validation', () => {
  // The field name absorbs the padding, so length can be tested at its boundary
  // without the document also failing the syntax check.
  const documentOfLength = (length: number) => `query Q { ${'a'.repeat(length - 'query Q {  }'.length)} }`;

  it('accepts a document at the limit', () => {
    expect(operationSaveError(documentOfLength(MAX_OPERATION_LENGTH), undefined)).toBeUndefined();
  });

  it('rejects a document over the limit', () => {
    expect(operationSaveError(documentOfLength(MAX_OPERATION_LENGTH + 1), undefined)).toBe(
      `Operation cannot be longer than ${MAX_OPERATION_LENGTH} characters`,
    );
  });

  it('rejects variables over the limit', () => {
    const oversized = `{"q":"${'v'.repeat(MAX_OPERATION_LENGTH)}"}`;
    expect(operationSaveError('query Q { a }', oversized)).toBe(
      `Operation variables cannot be longer than ${MAX_OPERATION_LENGTH} characters`,
    );
  });

  it('rejects an empty document', () => {
    expect(operationSaveError('   ', undefined)).toBe('Operation cannot be empty');
  });

  it('rejects a document that is not valid GraphQL', () => {
    expect(operationSaveError('query {{{', undefined)).toBe(
      'Operation is not valid GraphQL. Syntax Error: Expected Name, found "{".',
    );
    expect(operationSaveError('just some text', undefined)).toBe(
      'Operation is not valid GraphQL. Syntax Error: Unexpected Name "just".',
    );
  });

  it('accepts a document that parses but does not match the schema', () => {
    // Syntax only. This is the case that must keep working, or saved operations
    // break every time a field is removed from the graph.
    expect(operationSaveError('query Q { fieldThatDoesNotExist }', undefined)).toBeUndefined();
  });

  it('rejects variables that are not valid JSON', () => {
    expect(operationSaveError('query Q { a }', '{"id":')).toBe('Operation variables must be valid JSON');
  });

  it('ignores absent variables', () => {
    expect(operationSaveError('query Q { a }', undefined)).toBeUndefined();
    expect(operationSaveError('query Q { a }', '')).toBeUndefined();
  });

  // The server owns this limit; the client copy only avoids a pointless upload.
  // If the two drift, the user gets a confusing round-trip rejection instead.
  it('matches the limit the server enforces', () => {
    expect(MAX_OPERATION_LENGTH).toBe(100_000);
  });
});
