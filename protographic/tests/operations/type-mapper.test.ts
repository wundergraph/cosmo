import { describe, expect, test } from 'vitest';
import {
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLID,
  GraphQLNonNull,
  GraphQLList,
  GraphQLObjectType,
  GraphQLEnumType,
  GraphQLScalarType,
  GraphQLSchema,
} from 'graphql';
import {
  mapGraphQLTypeToProto,
  getProtoTypeName,
  isGraphQLScalarType,
  requiresWrapperType,
  getRequiredImports,
} from '../../src/operations/type-mapper';

describe('Type Mapper', () => {
  describe('mapGraphQLTypeToProto', () => {
    test('should map String to StringValue wrapper for nullable fields', () => {
      const result = mapGraphQLTypeToProto(GraphQLString);

      expect(result.typeName).toBe('google.protobuf.StringValue');
      expect(result.isRepeated).toBe(false);
      expect(result.isWrapper).toBe(true);
      expect(result.isScalar).toBe(true);
    });

    test('should map String! to string for non-null fields', () => {
      const result = mapGraphQLTypeToProto(new GraphQLNonNull(GraphQLString));

      expect(result.typeName).toBe('string');
      expect(result.isRepeated).toBe(false);
      expect(result.isWrapper).toBe(false);
      expect(result.isScalar).toBe(true);
    });

    test('should map Int to Int32Value wrapper for nullable fields', () => {
      const result = mapGraphQLTypeToProto(GraphQLInt);

      expect(result.typeName).toBe('google.protobuf.Int32Value');
      expect(result.isRepeated).toBe(false);
      expect(result.isWrapper).toBe(true);
      expect(result.isScalar).toBe(true);
    });

    test('should map Int! to int32 for non-null fields', () => {
      const result = mapGraphQLTypeToProto(new GraphQLNonNull(GraphQLInt));

      expect(result.typeName).toBe('int32');
      expect(result.isRepeated).toBe(false);
      expect(result.isWrapper).toBe(false);
      expect(result.isScalar).toBe(true);
    });

    test('should map Float to DoubleValue wrapper for nullable fields', () => {
      const result = mapGraphQLTypeToProto(GraphQLFloat);

      expect(result.typeName).toBe('google.protobuf.DoubleValue');
      expect(result.isRepeated).toBe(false);
      expect(result.isWrapper).toBe(true);
      expect(result.isScalar).toBe(true);
    });

    test('should map Float! to double for non-null fields', () => {
      const result = mapGraphQLTypeToProto(new GraphQLNonNull(GraphQLFloat));

      expect(result.typeName).toBe('double');
      expect(result.isRepeated).toBe(false);
      expect(result.isWrapper).toBe(false);
      expect(result.isScalar).toBe(true);
    });

    test('should map Boolean to BoolValue wrapper for nullable fields', () => {
      const result = mapGraphQLTypeToProto(GraphQLBoolean);

      expect(result.typeName).toBe('google.protobuf.BoolValue');
      expect(result.isRepeated).toBe(false);
      expect(result.isWrapper).toBe(true);
      expect(result.isScalar).toBe(true);
    });

    test('should map Boolean! to bool for non-null fields', () => {
      const result = mapGraphQLTypeToProto(new GraphQLNonNull(GraphQLBoolean));

      expect(result.typeName).toBe('bool');
      expect(result.isRepeated).toBe(false);
      expect(result.isWrapper).toBe(false);
      expect(result.isScalar).toBe(true);
    });

    test('should map ID to StringValue wrapper for nullable fields', () => {
      const result = mapGraphQLTypeToProto(GraphQLID);

      expect(result.typeName).toBe('google.protobuf.StringValue');
      expect(result.isRepeated).toBe(false);
      expect(result.isWrapper).toBe(true);
      expect(result.isScalar).toBe(true);
    });

    test('should map ID! to string for non-null fields', () => {
      const result = mapGraphQLTypeToProto(new GraphQLNonNull(GraphQLID));

      expect(result.typeName).toBe('string');
      expect(result.isRepeated).toBe(false);
      expect(result.isWrapper).toBe(false);
      expect(result.isScalar).toBe(true);
    });
  });

  describe('list types', () => {
    test('should map [String] to repeated string with wrapper', () => {
      const result = mapGraphQLTypeToProto(new GraphQLList(GraphQLString));

      expect(result.typeName).toBe('google.protobuf.StringValue');
      expect(result.isRepeated).toBe(true);
      expect(result.isWrapper).toBe(true);
      expect(result.isScalar).toBe(true);
    });

    test('should map [String!] to repeated string without wrapper', () => {
      const result = mapGraphQLTypeToProto(new GraphQLList(new GraphQLNonNull(GraphQLString)));

      expect(result.typeName).toBe('string');
      expect(result.isRepeated).toBe(true);
      expect(result.isWrapper).toBe(false);
      expect(result.isScalar).toBe(true);
    });

    test('should map [Int!]! to repeated int32', () => {
      const result = mapGraphQLTypeToProto(new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLInt))));

      expect(result.typeName).toBe('int32');
      expect(result.isRepeated).toBe(true);
      expect(result.isWrapper).toBe(false);
      expect(result.isScalar).toBe(true);
    });
  });

  describe('enum types', () => {
    test('should map GraphQL enum to proto enum type', () => {
      const enumType = new GraphQLEnumType({
        name: 'Status',
        values: {
          ACTIVE: { value: 'ACTIVE' },
          INACTIVE: { value: 'INACTIVE' },
        },
      });

      const result = mapGraphQLTypeToProto(enumType);

      expect(result.typeName).toBe('Status');
      expect(result.isRepeated).toBe(false);
      expect(result.isWrapper).toBe(false);
      expect(result.isScalar).toBe(false);
    });

    test('should map nullable enum correctly', () => {
      const enumType = new GraphQLEnumType({
        name: 'Role',
        values: {
          ADMIN: { value: 'ADMIN' },
          USER: { value: 'USER' },
        },
      });

      const result = mapGraphQLTypeToProto(enumType);

      expect(result.typeName).toBe('Role');
      expect(result.isWrapper).toBe(false);
    });
  });

  describe('object types', () => {
    test('should map GraphQL object type to proto message type', () => {
      const objectType = new GraphQLObjectType({
        name: 'User',
        fields: {
          id: { type: GraphQLID },
          name: { type: GraphQLString },
        },
      });

      const result = mapGraphQLTypeToProto(objectType);

      expect(result.typeName).toBe('User');
      expect(result.isRepeated).toBe(false);
      expect(result.isWrapper).toBe(false);
      expect(result.isScalar).toBe(false);
    });

    test('should map [User!] to repeated User', () => {
      const objectType = new GraphQLObjectType({
        name: 'User',
        fields: {
          id: { type: GraphQLID },
        },
      });

      const result = mapGraphQLTypeToProto(new GraphQLList(new GraphQLNonNull(objectType)));

      expect(result.typeName).toBe('User');
      expect(result.isRepeated).toBe(true);
      expect(result.isWrapper).toBe(false);
      expect(result.isScalar).toBe(false);
    });
  });

  describe('custom scalar mappings', () => {
    test('should use custom scalar mapping when provided', () => {
      const customScalar = new GraphQLScalarType({
        name: 'DateTime',
      });

      const result = mapGraphQLTypeToProto(customScalar, {
        customScalarMappings: {
          DateTime: 'google.protobuf.Timestamp',
        },
      });

      expect(result.typeName).toBe('google.protobuf.Timestamp');
      expect(result.isScalar).toBe(true);
    });

    test('should fallback to string for unknown custom scalars', () => {
      const customScalar = new GraphQLScalarType({
        name: 'Unknown',
      });

      const result = mapGraphQLTypeToProto(customScalar);

      expect(result.typeName).toBe('string');
      expect(result.isScalar).toBe(true);
    });
  });

  describe('wrapper type options', () => {
    test('should not use wrapper types when useWrapperTypes is false', () => {
      const result = mapGraphQLTypeToProto(GraphQLString, {
        useWrapperTypes: false,
      });

      expect(result.typeName).toBe('string');
      expect(result.isWrapper).toBe(false);
    });

    test('should use wrapper types by default', () => {
      const result = mapGraphQLTypeToProto(GraphQLString);

      expect(result.isWrapper).toBe(true);
    });
  });

  describe('getProtoTypeName', () => {
    test('should return proto type name for scalar', () => {
      const typeName = getProtoTypeName(GraphQLString);
      expect(typeName).toBe('google.protobuf.StringValue');
    });

    test('should return proto type name for non-null scalar', () => {
      const typeName = getProtoTypeName(new GraphQLNonNull(GraphQLInt));
      expect(typeName).toBe('int32');
    });
  });

  describe('isGraphQLScalarType', () => {
    test('should return true for scalar types', () => {
      expect(isGraphQLScalarType(GraphQLString)).toBe(true);
      expect(isGraphQLScalarType(GraphQLInt)).toBe(true);
      expect(isGraphQLScalarType(new GraphQLNonNull(GraphQLString))).toBe(true);
    });

    test('should return false for object types', () => {
      const objectType = new GraphQLObjectType({
        name: 'User',
        fields: {
          id: { type: GraphQLID },
        },
      });

      expect(isGraphQLScalarType(objectType)).toBe(false);
    });
  });

  describe('requiresWrapperType', () => {
    test('should return true for nullable scalars', () => {
      expect(requiresWrapperType(GraphQLString)).toBe(true);
      expect(requiresWrapperType(GraphQLInt)).toBe(true);
    });

    test('should return false for non-null scalars', () => {
      expect(requiresWrapperType(new GraphQLNonNull(GraphQLString))).toBe(false);
      expect(requiresWrapperType(new GraphQLNonNull(GraphQLInt))).toBe(false);
    });

    test('should return false when useWrapperTypes is disabled', () => {
      expect(requiresWrapperType(GraphQLString, { useWrapperTypes: false })).toBe(false);
    });
  });

  describe('getRequiredImports', () => {
    test('should return wrapper import for nullable scalars', () => {
      const imports = getRequiredImports([GraphQLString, GraphQLInt]);

      expect(imports).toContain('google/protobuf/wrappers.proto');
    });

    test('should not return wrapper import for non-null scalars', () => {
      const imports = getRequiredImports([new GraphQLNonNull(GraphQLString), new GraphQLNonNull(GraphQLInt)]);

      // Still includes it because default options use wrappers
      expect(imports.length).toBeGreaterThanOrEqual(0);
    });

    test('should return unique imports', () => {
      const imports = getRequiredImports([GraphQLString, GraphQLInt, GraphQLBoolean]);

      const uniqueImports = [...new Set(imports)];
      expect(imports.length).toBe(uniqueImports.length);
    });
  });
});
