import { describe, expect, test } from 'vitest';
import { getNormalizedFieldSet } from '../src/normalization/utils';
import { parse } from 'graphql';

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
