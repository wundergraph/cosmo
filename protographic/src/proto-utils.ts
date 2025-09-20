import {
    GraphQLType,
    GraphQLNonNull,
    GraphQLList,
    GraphQLNamedType,
    GraphQLSchema,
    GraphQLObjectType,
    isNonNullType,
    isListType,
    isScalarType,
    isEnumType,
    getNamedType,
} from 'graphql';

/**
 * Maps GraphQL scalar types to Protocol Buffer types
 *
 * GraphQL has a smaller set of primitive types compared to Protocol Buffers.
 * This mapping ensures consistent representation between the two type systems.
 */
export const SCALAR_TYPE_MAP: Record<string, string> = {
  ID: 'string', // GraphQL IDs map to Proto strings
  String: 'string', // Direct mapping
  Int: 'int32', // GraphQL Int is 32-bit signed
  Float: 'double', // Using double for GraphQL Float gives better precision
  Boolean: 'bool', // Direct mapping
};

/**
 * Maps GraphQL scalar types to Protocol Buffer wrapper types for nullable fields
 *
 * These wrapper types allow distinguishing between unset fields and zero values
 * in Protocol Buffers, which is important for GraphQL nullable semantics.
 */
export const SCALAR_WRAPPER_TYPE_MAP: Record<string, string> = {
  ID: 'google.protobuf.StringValue',
  String: 'google.protobuf.StringValue',
  Int: 'google.protobuf.Int32Value',
  Float: 'google.protobuf.DoubleValue',
  Boolean: 'google.protobuf.BoolValue',
};

/**
 * Data structure for formatting message fields
 */
export interface ProtoType {
    typeName: string;
    isRepeated: boolean;
}

/**
 * Convert GraphQL variable type node to Protocol Buffer type using SCALAR_TYPE_MAP
 */
export function convertVariableTypeToProto(typeNode: any): string {
  if (typeNode.kind === 'NonNullType') {
    return convertVariableTypeToProto(typeNode.type);
  }

  if (typeNode.kind === 'ListType') {
    return `repeated ${convertVariableTypeToProto(typeNode.type)}`;
  }

  if (typeNode.kind === 'NamedType') {
    const typeName = typeNode.name.value;
    return SCALAR_TYPE_MAP[typeName] || 'string';
  }

  return 'string';
}

/**
 * Check if a GraphQL type is a list type (handles NonNull wrappers)
 */
export function isGraphQLListType(graphqlType: GraphQLType): boolean {
    // Handle NonNull wrapper
    if (isNonNullType(graphqlType)) {
        return isGraphQLListType(graphqlType.ofType);
    }

    // Check if it's a list type
    return isListType(graphqlType);
}

/**
 * Get the root type for an operation (Query, Mutation, Subscription)
 */
export function getRootTypeForOperation(schema: GraphQLSchema, operationType: string): GraphQLObjectType {
    switch (operationType) {
        case 'query':
            const queryType = schema.getQueryType();
            if (!queryType) throw new Error('Schema does not define Query type');
            return queryType;
        case 'mutation':
            const mutationType = schema.getMutationType();
            if (!mutationType) throw new Error('Schema does not define Mutation type');
            return mutationType;
        case 'subscription':
            const subscriptionType = schema.getSubscriptionType();
            if (!subscriptionType) throw new Error('Schema does not define Subscription type');
            return subscriptionType;
        default:
            throw new Error(`Unknown operation type: ${operationType}`);
    }
}

/**
 * Map GraphQL type to Protocol Buffer type
 * Battle-tested implementation from sdl-to-proto-visitor.ts
 */
export function getProtoTypeFromGraphQL(
    graphqlType: GraphQLType,
    ignoreWrapperTypes: boolean = false,
    usesWrapperTypesTracker?: { usesWrapperTypes: boolean }
): ProtoType {
    // Nullable lists need to be handled first, otherwise they will be treated as scalar types
    if (isListType(graphqlType) || (isNonNullType(graphqlType) && isListType(graphqlType.ofType))) {
        return handleListType(graphqlType, usesWrapperTypesTracker);
    }
    // For nullable scalar types, use wrapper types
    if (isScalarType(graphqlType)) {
        if (ignoreWrapperTypes) {
            return { typeName: SCALAR_TYPE_MAP[graphqlType.name] || 'string', isRepeated: false };
        }
        if (usesWrapperTypesTracker) {
            usesWrapperTypesTracker.usesWrapperTypes = true; // Track that we're using wrapper types
        }
        return {
            typeName: SCALAR_WRAPPER_TYPE_MAP[graphqlType.name] || 'google.protobuf.StringValue',
            isRepeated: false,
        };
    }

    if (isEnumType(graphqlType)) {
        return { typeName: graphqlType.name, isRepeated: false };
    }

    if (isNonNullType(graphqlType)) {
        // For non-null scalar types, use the base type
        if (isScalarType(graphqlType.ofType)) {
            return { typeName: SCALAR_TYPE_MAP[graphqlType.ofType.name] || 'string', isRepeated: false };
        }

        return getProtoTypeFromGraphQL(graphqlType.ofType, ignoreWrapperTypes, usesWrapperTypesTracker);
    }
    // Named types (object, interface, union, input)
    const namedType = graphqlType as GraphQLNamedType;
    if (namedType && typeof namedType.name === 'string') {
        return { typeName: namedType.name, isRepeated: false };
    }

    return { typeName: 'string', isRepeated: false }; // Default fallback
}

/**
 * Handle GraphQL list types
 * Simplified version that works for both SDL and operations visitors
 */
export function handleListType(
    graphqlType: GraphQLList<GraphQLType> | GraphQLNonNull<GraphQLList<GraphQLType>>,
    usesWrapperTypesTracker?: { usesWrapperTypes: boolean }
): ProtoType {
    const listType = isNonNullType(graphqlType) ? graphqlType.ofType as GraphQLList<GraphQLType> : graphqlType as GraphQLList<GraphQLType>;
    
    // Get the inner type of the list
    let innerType = listType.ofType;
    
    // Unwrap NonNull if present
    if (isNonNullType(innerType)) {
        innerType = innerType.ofType;
    }
    
    // Convert the inner type
    const protoType = getProtoTypeFromGraphQL(innerType, true, usesWrapperTypesTracker);
    return { ...protoType, isRepeated: true };
}

/**
 * Build the proto file header with syntax, package, imports, and options
 */
export function buildProtoHeader(packageName: string, imports: string[], options: string[]): string[] {
    const header: string[] = [];

    // Add syntax declaration
    header.push('syntax = "proto3";');

    // Add package declaration
    header.push(`package ${packageName};`);
    header.push('');

    // Add options if any (options come before imports)
    if (options.length > 0) {
        // Sort options for consistent output
        const sortedOptions = [...options].sort();
        for (const option of sortedOptions) {
            header.push(option);
        }
        header.push('');
    }

    // Add imports if any
    if (imports.length > 0) {
        // Sort imports for consistent output
        const sortedImports = [...imports].sort();
        for (const importPath of sortedImports) {
            header.push(`import "${importPath}";`);
        }
        header.push('');
    }

    return header;
}

/**
 * Create an RPC method definition with optional comment
 *
 * @param methodName - The name of the RPC method
 * @param requestName - The request message name
 * @param responseName - The response message name
 * @param includeComments - Whether to include comments in the output
 * @param description - Optional description for the method
 * @returns The RPC method definition with or without comment
 */
export function createRpcMethod(
    methodName: string,
    requestName: string,
    responseName: string,
    includeComments: boolean,
    description?: string | null,
): string {
    if (!includeComments || !description) {
        return `rpc ${methodName}(${requestName}) returns (${responseName}) {}`;
    }

    // RPC method comments should be indented 1 level (2 spaces)
    const commentLines = formatComment(description, includeComments, 1);
    const methodLine = `  rpc ${methodName}(${requestName}) returns (${responseName}) {}`;

    return [...commentLines, methodLine].join('\n');
}

/**
 * Convert a GraphQL description to Protocol Buffer comment
 * @param description - The GraphQL description text
 * @param includeComments - Whether to include comments in the output
 * @param indentLevel - The level of indentation for the comment (in number of 2-space blocks)
 * @returns Array of comment lines with proper indentation
 */
export function formatComment(description: string | undefined | null, includeComments: boolean, indentLevel: number = 0): string[] {
    if (!includeComments || !description) {
        return [];
    }

    // Use 2-space indentation consistently
    const indent = '  '.repeat(indentLevel);
    const lines = description.trim().split('\n');

    if (lines.length === 1) {
        return [`${indent}// ${lines[0]}`];
    } else {
        return [`${indent}/*`, ...lines.map((line) => `${indent} * ${line}`), `${indent} */`];
    }
}
