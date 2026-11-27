import { describe, expect, test } from 'vitest';
import { doesFieldSetSelectLeafPath, getNormalizedFieldSet, parse } from '../../src';

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
