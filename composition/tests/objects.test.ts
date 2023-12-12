import { describe, expect, test } from 'vitest';
import { noFieldDefinitionsError, normalizeSubgraphFromString } from '../src';

describe('Objects tests', () => {
  describe('Normalization tests', () => {
    test('that an error is returned if an object does not define any fields', () => {
      const { errors } = normalizeSubgraphFromString(`
        type Object
      `);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noFieldDefinitionsError('object', 'Object'));
    });

    test('that an error is returned if an extended interface does not have any fields', () => {
      const { errors } = normalizeSubgraphFromString(`
        type Object
        
        extend type Object @tag(name: "test")
      `);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noFieldDefinitionsError('object', 'Object'));
    });
  });
});