import {
  GraphQLType,
  GraphQLNamedType,
  isScalarType,
  isEnumType,
  isObjectType,
  isInterfaceType,
  isUnionType,
  isInputObjectType,
  isListType,
  isNonNullType,
  getNamedType,
  GraphQLScalarType,
} from 'graphql';
import { unwrapNonNullType, isNestedListType, calculateNestingLevel } from './list-type-utils.js';

/**
 * Maps GraphQL scalar types to Protocol Buffer types
 */
const SCALAR_TYPE_MAP: Record<string, string> = {
  ID: 'string',
  String: 'string',
  Int: 'int32',
  Float: 'double',
  Boolean: 'bool',
};

/**
 * Maps GraphQL scalar types to Protocol Buffer wrapper types for nullable fields
 */
const SCALAR_WRAPPER_TYPE_MAP: Record<string, string> = {
  ID: 'google.protobuf.StringValue',
  String: 'google.protobuf.StringValue',
  Int: 'google.protobuf.Int32Value',
  Float: 'google.protobuf.DoubleValue',
  Boolean: 'google.protobuf.BoolValue',
};

/**
 * Represents the proto type information for a GraphQL type
 */
export interface ProtoTypeInfo {
  /** The proto type name */
  typeName: string;
  /** Whether the field should be repeated (for lists) */
  isRepeated: boolean;
  /** Whether this is a wrapper type */
  isWrapper: boolean;
  /** Whether this is a scalar type */
  isScalar: boolean;
  /** Whether this requires a nested list wrapper message */
  requiresNestedWrapper?: boolean;
  /** The nesting level for nested lists (e.g., 2 for [[String]]) */
  nestingLevel?: number;
}

/**
 * Options for mapping GraphQL types to Proto types
 */
export interface TypeMapperOptions {
  /** Custom scalar type mappings (scalar name -> proto type) */
  customScalarMappings?: Record<string, string>;
  /** Whether to use wrapper types for nullable scalars (default: true) */
  useWrapperTypes?: boolean;
}

/**
 * Map a GraphQL type to its corresponding Protocol Buffer type information.
 *
 * @param type - The GraphQL type to map
 * @param options - Optional configuration controlling custom scalar mappings and wrapper usage
 * @returns ProtoTypeInfo containing the proto type name and flags such as `isRepeated`, `isWrapper`, `isScalar`, and optional nested-list metadata
 */
export function mapGraphQLTypeToProto(type: GraphQLType, options?: TypeMapperOptions): ProtoTypeInfo {
  const useWrapperTypes = options?.useWrapperTypes ?? true;
  const customScalarMappings = options?.customScalarMappings ?? {};

  // Check for nested lists first (before handling non-null)
  if (isListType(type) || (isNonNullType(type) && isListType(type.ofType))) {
    return handleListType(type, options);
  }

  // Handle non-null types
  if (isNonNullType(type)) {
    const innerType = type.ofType;
    const innerInfo = mapGraphQLTypeToProto(innerType, options);

    // For non-null scalars, we don't use wrapper types
    if (isScalarType(getNamedType(innerType))) {
      const namedType = getNamedType(innerType) as GraphQLScalarType;
      const scalarName = namedType.name;

      // Check custom mappings first
      if (customScalarMappings[scalarName]) {
        return {
          typeName: customScalarMappings[scalarName],
          isRepeated: innerInfo.isRepeated,
          isWrapper: false,
          isScalar: true,
        };
      }

      // Use direct scalar type for non-null fields
      if (SCALAR_TYPE_MAP[scalarName]) {
        return {
          typeName: SCALAR_TYPE_MAP[scalarName],
          isRepeated: innerInfo.isRepeated,
          isWrapper: false,
          isScalar: true,
        };
      }
    }

    return innerInfo;
  }

  // Get the named type
  const namedType = getNamedType(type);

  // Handle scalar types
  if (isScalarType(namedType)) {
    const scalarName = namedType.name;

    // Check custom mappings first
    if (customScalarMappings[scalarName]) {
      return {
        typeName: customScalarMappings[scalarName],
        isRepeated: false,
        isWrapper: false,
        isScalar: true,
      };
    }

    // Use wrapper types for nullable scalars
    if (useWrapperTypes && SCALAR_WRAPPER_TYPE_MAP[scalarName]) {
      return {
        typeName: SCALAR_WRAPPER_TYPE_MAP[scalarName],
        isRepeated: false,
        isWrapper: true,
        isScalar: true,
      };
    }

    // Fallback to direct mapping
    const protoType = SCALAR_TYPE_MAP[scalarName] || 'string';
    return {
      typeName: protoType,
      isRepeated: false,
      isWrapper: false,
      isScalar: true,
    };
  }

  // Handle enum types
  if (isEnumType(namedType)) {
    return {
      typeName: namedType.name,
      isRepeated: false,
      isWrapper: false,
      isScalar: false,
    };
  }

  // Handle input object types
  if (isInputObjectType(namedType)) {
    return {
      typeName: namedType.name,
      isRepeated: false,
      isWrapper: false,
      isScalar: false,
    };
  }

  // Handle object, interface, and union types
  if (isObjectType(namedType) || isInterfaceType(namedType) || isUnionType(namedType)) {
    return {
      typeName: namedType.name,
      isRepeated: false,
      isWrapper: false,
      isScalar: false,
    };
  }

  // Fallback for unknown types
  return {
    typeName: 'string',
    isRepeated: false,
    isWrapper: false,
    isScalar: true,
  };
}

/**
 * Determine the ProtoTypeInfo for a GraphQL list type, handling single-level and nested lists and preserving nullability semantics.
 *
 * @param graphqlType - The GraphQL type expected to be a list or a wrapped list (may be NonNull/List wrappers).
 * @param options - Mapping options that can override scalar mappings and control wrapper usage.
 * @returns A ProtoTypeInfo describing how the list should be represented in protobuf:
 * - For non-null single-level lists: `isRepeated: true` with the base item proto type.
 * - For nullable single-level lists: `isRepeated: true` and item wrapper usage determined by item type info.
 * - For nested lists: a generated wrapper message (`typeName`) is returned with `requiresNestedWrapper: true` and `isRepeated: false`.
 */
function handleListType(graphqlType: GraphQLType, options?: TypeMapperOptions): ProtoTypeInfo {
  const listType = unwrapNonNullType(graphqlType);
  const isNullableList = !isNonNullType(graphqlType);

  // Only check for nested lists if we have a list type
  if (!isListType(listType)) {
    // This shouldn't happen, but handle gracefully
    return mapGraphQLTypeToProto(listType, options);
  }

  const isNestedList = isNestedListType(listType);

  // Simple non-nullable lists can use repeated fields directly
  if (!isNullableList && !isNestedList) {
    const baseType = getNamedType(listType);
    const baseTypeInfo = mapGraphQLTypeToProto(baseType, { ...options, useWrapperTypes: false });
    return {
      ...baseTypeInfo,
      isRepeated: true,
    };
  }

  // Only nested lists need wrapper messages
  // Single-level nullable lists use repeated + wrapper types for nullable items
  if (isNestedList) {
    const baseType = getNamedType(listType);
    const nestingLevel = calculateNestingLevel(listType);

    // Generate wrapper message name
    const wrapperName = `${'ListOf'.repeat(nestingLevel)}${baseType.name}`;

    // For nested lists, never use repeated at field level to preserve nullability
    return {
      typeName: wrapperName,
      isRepeated: false,
      isWrapper: false,
      isScalar: false,
      requiresNestedWrapper: true,
      nestingLevel: nestingLevel,
    };
  }

  // Single-level nullable lists: [String], [String!], etc.
  // Use repeated with appropriate item type (wrapper type for nullable items)
  if (!isListType(listType)) {
    // Safety check - shouldn't happen
    return mapGraphQLTypeToProto(listType, options);
  }

  const itemType = listType.ofType;
  const itemTypeInfo = mapGraphQLTypeToProto(itemType, options);

  return {
    typeName: itemTypeInfo.typeName,
    isRepeated: true,
    isWrapper: itemTypeInfo.isWrapper,
    isScalar: itemTypeInfo.isScalar,
  };
}

/**
 * Retrieves the Protocol Buffer type name for a GraphQL type.
 *
 * @returns The Protocol Buffer type name.
 */
export function getProtoTypeName(type: GraphQLType, options?: TypeMapperOptions): string {
  const typeInfo = mapGraphQLTypeToProto(type, options);
  return typeInfo.typeName;
}

/**
 * Determine whether a GraphQL type resolves to a scalar type.
 *
 * @param type - The GraphQL type to check
 * @returns `true` if the type is a scalar, `false` otherwise
 */
export function isGraphQLScalarType(type: GraphQLType): boolean {
  return isScalarType(getNamedType(type));
}

/**
 * Determine whether a GraphQL type will be represented using a protobuf wrapper type.
 *
 * @param type - The GraphQL type to evaluate
 * @param options - Optional mapping configuration that can override scalar mappings and wrapper usage
 * @returns `true` if the GraphQL type maps to a protobuf wrapper type, `false` otherwise
 */
export function requiresWrapperType(type: GraphQLType, options?: TypeMapperOptions): boolean {
  const typeInfo = mapGraphQLTypeToProto(type, options);
  return typeInfo.isWrapper;
}

/**
 * Determine which protobuf import files are required for the given GraphQL types.
 *
 * @param types - GraphQL types to inspect for required proto imports
 * @param options - Optional mapping configuration that affects wrapper detection
 * @returns An array of import paths required by the provided types (for example, `google/protobuf/wrappers.proto`)
 */
export function getRequiredImports(types: GraphQLType[], options?: TypeMapperOptions): string[] {
  const imports = new Set<string>();

  for (const type of types) {
    const typeInfo = mapGraphQLTypeToProto(type, options);
    if (typeInfo.isWrapper) {
      imports.add('google/protobuf/wrappers.proto');
    }
  }

  return Array.from(imports);
}
