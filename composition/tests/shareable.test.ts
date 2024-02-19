import { describe, expect, test } from 'vitest';
import { normalizeSubgraphFromString } from '../src';
import { normalizeString, schemaToSortedNormalizedString, versionTwoDirectiveDefinitions } from './utils/utils';

describe('@shareable directive tests', () => {
  describe('Normalization tests', () => {
    test('that @shareable declared on the object level applies to all its defined fields #1.1', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object {
          shareableFieldOne(argOne: String!, argTwo: Boolean!): String @shareable
          nonShareableFieldOne: Boolean!
        }
        
        extend type Object @shareable {
          shareableFieldTwo: Int!
          shareableFieldThree: Float
        }
        
        type Object @shareable @extends {
          """
            This is the description for Object.shareableFieldFour
          """
          shareableFieldFour: String!
        }
        
        extend type Object {
          nonShareableFieldTwo(argOne: Int, """This is a description for Object.nonShareableFieldTwo.argTwo""" argTwo: Boolean!): Float!
          nonShareableFieldThree: Boolean
        }
      `);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          versionTwoDirectiveDefinitions +
            `
         type Object {
          nonShareableFieldOne: Boolean!
          nonShareableFieldThree: Boolean
          nonShareableFieldTwo(argOne: Int"""This is a description for Object.nonShareableFieldTwo.argTwo"""argTwo: Boolean!): Float!
          """
            This is the description for Object.shareableFieldFour
          """
          shareableFieldFour: String! @shareable
          shareableFieldOne(argOne: String!, argTwo: Boolean!): String @shareable
          shareableFieldThree: Float @shareable
          shareableFieldTwo: Int! @shareable
        }
        
        scalar openfed__FieldSet
        scalar openfed__Scope
      `,
        ),
      );
    });

    test('that @shareable declared on the object level applies to all its defined fields #1.2', () => {
      const { errors, normalizationResult } = normalizeSubgraphFromString(`
        type Object @shareable @extends {
          """
            This is the description for Object.shareableFieldFour
          """
          shareableFieldFour: String!
        }
        
        extend type Object {
          nonShareableFieldTwo(argOne: Int, """This is a description for Object.nonShareableFieldTwo.argTwo""" argTwo: Boolean!): Float!
          nonShareableFieldThree: Boolean
        }
        
        extend type Object @shareable {
          shareableFieldTwo: Int!
          shareableFieldThree: Float
        }
        
        type Object {
          shareableFieldOne(argOne: String!, argTwo: Boolean!): String @shareable
          nonShareableFieldOne: Boolean!
        }
      `);
      expect(errors).toBeUndefined();
      expect(schemaToSortedNormalizedString(normalizationResult!.schema)).toBe(
        normalizeString(
          versionTwoDirectiveDefinitions +
            `
         type Object {
          nonShareableFieldOne: Boolean!
          nonShareableFieldThree: Boolean
          nonShareableFieldTwo(argOne: Int"""This is a description for Object.nonShareableFieldTwo.argTwo"""argTwo: Boolean!): Float!
          """
            This is the description for Object.shareableFieldFour
          """
          shareableFieldFour: String! @shareable
          shareableFieldOne(argOne: String!, argTwo: Boolean!): String @shareable
          shareableFieldThree: Float @shareable
          shareableFieldTwo: Int! @shareable
        }
        
        scalar openfed__FieldSet
        scalar openfed__Scope
      `,
        ),
      );
    });
  });
});
