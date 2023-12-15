import { describe, expect, test } from 'vitest';
import { noFieldDefinitionsError, normalizeSubgraphFromString } from '../src';
import { normalizeString, versionOneBaseSchema } from './utils/utils';

describe('Objects tests', () => {
  describe('Normalization tests', () => {
    test('that an error is returned if an object does not define any fields', () => {
      const { errors } = normalizeSubgraphFromString(`
        type Object
      `);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noFieldDefinitionsError('object', 'Object'));
    });

    test('that an error is returned if an extended object does not have any fields', () => {
      const { errors } = normalizeSubgraphFromString(`
        type Object
        
        extend type Object @tag(name: "test")
      `);
      expect(errors).toBeDefined();
      expect(errors![0]).toStrictEqual(noFieldDefinitionsError('object', 'Object'));
    });

    test('that a Query root type that defines no fields is valid', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Query
      `);
      expect(errors).toBeUndefined();
      expect(normalizeString(normalizationResult!.subgraphString)).toBe(
        normalizeString(
          versionOneBaseSchema +
            `
        type Query
      `,
        ),
      );
    });

    test('that a renamed Query root type that defines no fields is valid', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        schema {
          query: Queries
        }
        
        type Queries
      `);
      expect(errors).toBeUndefined();
      expect(normalizeString(normalizationResult!.subgraphString)).toBe(
        normalizeString(
          versionOneBaseSchema +
            `
        schema {
          query: Queries
        }
        
        type Queries
      `,
        ),
      );
    });
  });
});
