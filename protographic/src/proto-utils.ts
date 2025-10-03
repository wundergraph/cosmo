import {
    GraphQLType,
    GraphQLNonNull,
    GraphQLList,
    GraphQLNamedType,
    GraphQLSchema,
    GraphQLObjectType,
    GraphQLEnumType,
    GraphQLInputObjectType,
    GraphQLInputField,
    isNonNullType,
    isListType,
    isScalarType,
    isEnumType,
    isInputObjectType,
    getNamedType,
} from 'graphql';
import { createEnumUnspecifiedValue, graphqlEnumValueToProtoEnumValue, graphqlFieldToProtoField } from './naming-conventions.js';
import type { ProtoLockManager } from './proto-lock.js';

/**
 * Maps GraphQL scalar types to Protocol Buffer types
 *
 * GraphQL has a smaller set of primitive types compared to Protocol Buffers.
 * This mapping ensures consistent representation between the two type systems.
 *
 * Custom scalars are mapped to appropriate Protocol Buffer types:
 * - DateTime, UUID, EmailAddress, URL, JSON, Decimal -> string
 * - BigInt -> int64
 * - Upload -> string (could be bytes, but string is more common for file references)
 */
export const SCALAR_TYPE_MAP: Record<string, string> = {
  // Built-in GraphQL scalars
  ID: 'string', // GraphQL IDs map to Proto strings
  String: 'string', // Direct mapping
  Int: 'int32', // GraphQL Int is 32-bit signed
  Float: 'double', // Using double for GraphQL Float gives better precision
  Boolean: 'bool', // Direct mapping
  
  // Common custom scalars
  DateTime: 'string', // ISO 8601 string representation
  UUID: 'string', // String representation of UUID
  JSON: 'string', // JSON serialized as string
  BigInt: 'int64', // Large integers map to int64
  Decimal: 'string', // Decimal numbers as string to preserve precision
  EmailAddress: 'string', // Email addresses as strings
  URL: 'string', // URLs as strings
  Upload: 'string', // File uploads as string references (could be bytes)
};

/**
 * Maps GraphQL scalar types to Protocol Buffer wrapper types for nullable fields
 *
 * These wrapper types allow distinguishing between unset fields and zero values
 * in Protocol Buffers, which is important for GraphQL nullable semantics.
 */
export const SCALAR_WRAPPER_TYPE_MAP: Record<string, string> = {
  // Built-in GraphQL scalars
  ID: 'google.protobuf.StringValue',
  String: 'google.protobuf.StringValue',
  Int: 'google.protobuf.Int32Value',
  Float: 'google.protobuf.DoubleValue',
  Boolean: 'google.protobuf.BoolValue',
  
  // Common custom scalars
  DateTime: 'google.protobuf.StringValue',
  UUID: 'google.protobuf.StringValue',
  JSON: 'google.protobuf.StringValue',
  BigInt: 'google.protobuf.Int64Value',
  Decimal: 'google.protobuf.StringValue',
  EmailAddress: 'google.protobuf.StringValue',
  URL: 'google.protobuf.StringValue',
  Upload: 'google.protobuf.StringValue',
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
    // Return scalar types or the actual type name for input objects/enums
    return SCALAR_TYPE_MAP[typeName] || typeName;
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
 * Create an RPC method definition with optional comment and options
 *
 * @param methodName - The name of the RPC method
 * @param requestName - The request message name
 * @param responseName - The response message name
 * @param includeComments - Whether to include comments in the output
 * @param description - Optional description for the method
 * @param options - Optional RPC options to include in the method definition
 * @param gnosticOptions - Optional gnostic OpenAPI options for the method
 * @returns The RPC method definition with or without comment and options
 */
export function createRpcMethod(
    methodName: string,
    requestName: string,
    responseName: string,
    includeComments: boolean,
    description?: string | null,
    options?: string[],
    gnosticOptions?: string[]
): string {
    // Combine regular options with gnostic options
    const allOptions = [...(options || []), ...(gnosticOptions || [])];
    const hasOptions = allOptions.length > 0;
    
    if (!includeComments || !description) {
        if (!hasOptions) {
            return `rpc ${methodName}(${requestName}) returns (${responseName}) {}`;
        } else {
            const optionsStr = allOptions.map(opt => `  ${opt}`).join('\n');
            return `rpc ${methodName}(${requestName}) returns (${responseName}) {\n${optionsStr}\n}`;
        }
    }

    // RPC method comments should be indented 1 level (2 spaces)
    const commentLines = formatComment(description, includeComments, 1);
    
    if (!hasOptions) {
        const methodLine = `  rpc ${methodName}(${requestName}) returns (${responseName}) {}`;
        return [...commentLines, methodLine].join('\n');
    } else {
        const methodStart = `  rpc ${methodName}(${requestName}) returns (${responseName}) {`;
        const optionsStr = allOptions.map(opt => `    ${opt}`).join('\n');
        const methodEnd = '  }';
        return [...commentLines, methodStart, optionsStr, methodEnd].join('\n');
    }
}

/**
 * Escape a string value for use in Protocol Buffer options
 * Handles newlines, quotes, and other special characters
 */
function escapeProtoString(value: string): string {
    return value
        .replace(/\\/g, '\\\\')  // Escape backslashes first
        .replace(/"/g, '\\"')     // Escape double quotes
        .replace(/\n/g, '\\n')    // Escape newlines
        .replace(/\r/g, '\\r')    // Escape carriage returns
        .replace(/\t/g, '\\t');   // Escape tabs
}

/**
 * Generate gnostic OpenAPI v3 options for an RPC method
 * Combines all metadata into a single option statement
 * These options are used by protoc-gen-connect-openapi to generate OpenAPI specifications
 *
 * @param metadata - OpenAPI metadata extracted from @openapi directive
 * @returns Array with a single gnostic option string (or empty array if no metadata)
 */
export function generateGnosticOptions(metadata: {
    operationId?: string;
    summary?: string;
    description?: string;
    tags?: string[];
    deprecated?: boolean;
    externalDocs?: { description?: string; url: string };
}): string[] {
    const fields: string[] = [];
    
    if (metadata.operationId) {
        fields.push(`operation_id: "${escapeProtoString(metadata.operationId)}"`);
    }
    
    if (metadata.summary) {
        fields.push(`summary: "${escapeProtoString(metadata.summary)}"`);
    }
    
    if (metadata.description) {
        fields.push(`description: "${escapeProtoString(metadata.description)}"`);
    }
    
    if (metadata.tags && metadata.tags.length > 0) {
        const tagsStr = metadata.tags.map(tag => `"${escapeProtoString(tag)}"`).join(', ');
        fields.push(`tags: [${tagsStr}]`);
    }
    
    if (metadata.deprecated) {
        fields.push(`deprecated: true`);
    }
    
    if (metadata.externalDocs) {
        const docsFields: string[] = [];
        if (metadata.externalDocs.description) {
            docsFields.push(`description: "${escapeProtoString(metadata.externalDocs.description)}"`);
        }
        docsFields.push(`url: "${escapeProtoString(metadata.externalDocs.url)}"`);
        fields.push(`external_docs: { ${docsFields.join(', ')} }`);
    }
    
    // Only return an option if we have at least one field
    if (fields.length === 0) {
        return [];
    }
    
    // Combine all fields into a single option statement
    const optionContent = fields.join(', ');
    return [`option (gnostic.openapi.v3.operation) = { ${optionContent} };`];
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

/**
 * Generate a Protocol Buffer enum definition from a GraphQL enum type
 * Shared implementation used by both SDL and operations visitors
 */
export function generateEnumDefinition(
    enumType: GraphQLEnumType,
    lockManager: ProtoLockManager,
    includeComments: boolean = false
): string {
    const lines: string[] = [];

    // Add enum description as comment if available
    if (enumType.description && includeComments) {
        lines.push(...formatComment(enumType.description, includeComments, 0));
    }

    lines.push(`enum ${enumType.name} {`);

    // Add unspecified value as first enum value (required in proto3)
    const unspecifiedValue = createEnumUnspecifiedValue(enumType.name);
    lines.push(`  ${unspecifiedValue} = 0;`);

    // Get enum values and order them using the lock manager
    const values = enumType.getValues();
    const valueNames = values.map(v => v.name);
    const orderedValueNames = lockManager.reconcileEnumValueOrder(enumType.name, valueNames);

    for (const valueName of orderedValueNames) {
        const value = values.find(v => v.name === valueName);
        if (!value) continue;

        const protoEnumValue = graphqlEnumValueToProtoEnumValue(enumType.name, value.name);

        // Get value number from lock data
        const lockData = lockManager.getLockData();
        let valueNumber = 1; // Start from 1 since 0 is reserved for UNSPECIFIED

        if (lockData.enums[enumType.name] && lockData.enums[enumType.name].fields[value.name]) {
            valueNumber = lockData.enums[enumType.name].fields[value.name];
        } else {
            // Find the next available number if not in lock data
            const usedNumbers = new Set([0]); // 0 is reserved for UNSPECIFIED
            if (lockData.enums[enumType.name]) {
                Object.values(lockData.enums[enumType.name].fields).forEach(num => usedNumbers.add(num));
            }
            while (usedNumbers.has(valueNumber)) {
                valueNumber++;
            }
        }

        // Add value description as comment if available
        if (value.description && includeComments) {
            lines.push(...formatComment(value.description, includeComments, 1));
        }

        lines.push(`  ${protoEnumValue} = ${valueNumber};`);
    }

    lines.push('}');

    return lines.join('\n');
}

/**
 * Generate a Protocol Buffer message from a GraphQL input object type
 * Shared implementation extracted from SDL-to-proto visitor
 */
export function generateInputMessageFromSchema(
    inputType: GraphQLInputObjectType,
    lockManager: ProtoLockManager,
    includeComments: boolean = false,
    usesWrapperTypesTracker?: { usesWrapperTypes: boolean }
): string {
    const lines: string[] = [];

    // Add type description as comment before message definition
    if (inputType.description && includeComments) {
        lines.push(...formatComment(inputType.description, includeComments, 0));
    }

    lines.push(`message ${inputType.name} {`);

    const fields = inputType.getFields();

    // Get field names and order them using the lock manager
    const fieldNames = Object.keys(fields);
    const orderedFieldNames = lockManager.reconcileMessageFieldOrder(inputType.name, fieldNames);

    let fieldNumber = 1;
    for (const fieldName of orderedFieldNames) {
        if (!fields[fieldName]) continue;

        const field = fields[fieldName];
        const fieldType = getProtoTypeFromGraphQL(field.type, false, usesWrapperTypesTracker);
        const protoFieldName = graphqlFieldToProtoField(fieldName);

        // Add field description as comment
        if (field.description && includeComments) {
            lines.push(...formatComment(field.description, includeComments, 1));
        }

        if (fieldType.isRepeated) {
            lines.push(`  repeated ${fieldType.typeName} ${protoFieldName} = ${fieldNumber++};`);
        } else {
            lines.push(`  ${fieldType.typeName} ${protoFieldName} = ${fieldNumber++};`);
        }
    }

    lines.push('}');

    return lines.join('\n');
}

/**
 * Recursively collect all nested input type dependencies from a GraphQL input type
 * Returns them in dependency order (dependencies first, then dependents)
 */
export function collectNestedInputDependencies(
    inputType: GraphQLInputObjectType,
    schema: GraphQLSchema,
    visited: Set<string> = new Set()
): GraphQLInputObjectType[] {
    const dependencies: GraphQLInputObjectType[] = [];
    
    // Avoid infinite recursion
    if (visited.has(inputType.name)) {
        return dependencies;
    }
    visited.add(inputType.name);

    const fields = inputType.getFields();
    
    // First, collect all dependencies
    for (const [fieldName, field] of Object.entries(fields)) {
        const namedType = getNamedType(field.type);
        
        if (isInputObjectType(namedType) && !visited.has(namedType.name)) {
            // Recursively collect dependencies of this nested input type
            const nestedDependencies = collectNestedInputDependencies(namedType, schema, visited);
            dependencies.push(...nestedDependencies);
            
            // Add the nested input type itself
            dependencies.push(namedType);
        }
    }

    return dependencies;
}

/**
 * Process a list of input types and generate their Protocol Buffer messages
 * Handles dependency resolution to ensure nested types are generated in correct order
 */
export function processInputTypeQueue(
    inputTypes: GraphQLInputObjectType[],
    schema: GraphQLSchema,
    lockManager: ProtoLockManager,
    includeComments: boolean = false,
    usesWrapperTypesTracker?: { usesWrapperTypes: boolean }
): string[] {
    const messages: string[] = [];
    const processed = new Set<string>();

    // Process each input type and its dependencies
    for (const inputType of inputTypes) {
        if (processed.has(inputType.name)) {
            continue;
        }

        // Get all dependencies in correct order
        const dependencies = collectNestedInputDependencies(inputType, schema);
        
        // Process dependencies first
        for (const dependency of dependencies) {
            if (!processed.has(dependency.name)) {
                const message = generateInputMessageFromSchema(
                    dependency,
                    lockManager,
                    includeComments,
                    usesWrapperTypesTracker
                );
                messages.push(message);
                processed.add(dependency.name);
            }
        }

        // Then process the main input type
        if (!processed.has(inputType.name)) {
            const message = generateInputMessageFromSchema(
                inputType,
                lockManager,
                includeComments,
                usesWrapperTypesTracker
            );
            messages.push(message);
            processed.add(inputType.name);
        }
    }

    return messages;
}

/**
 * Extract all input object types referenced by a GraphQL type (handles NonNull and List wrappers)
 * Shared utility for collecting input type dependencies
 */
export function extractInputTypesFromGraphQLType(graphqlType: GraphQLType, schema: GraphQLSchema): GraphQLInputObjectType[] {
    const inputTypes: GraphQLInputObjectType[] = [];
    
    // Unwrap NonNull and List types to get to the named type
    const namedType = getNamedType(graphqlType);
    
    if (isInputObjectType(namedType)) {
        inputTypes.push(namedType);
        
        // Recursively collect nested input types
        const dependencies = collectNestedInputDependencies(namedType, schema);
        inputTypes.push(...dependencies);
    }
    
    return inputTypes;
}

/**
 * Collect enum types from a GraphQL type node (handles NonNull and List wrappers)
 * Shared utility for both SDL and operations visitors
 */
export function collectEnumsFromTypeNode(typeNode: any, schema: GraphQLSchema, enumsUsed: Set<string>): void {
    if (typeNode.kind === 'NonNullType') {
        collectEnumsFromTypeNode(typeNode.type, schema, enumsUsed);
    } else if (typeNode.kind === 'ListType') {
        collectEnumsFromTypeNode(typeNode.type, schema, enumsUsed);
    } else if (typeNode.kind === 'NamedType') {
        const typeName = typeNode.name.value;
        const type = schema.getTypeMap()[typeName];
        if (type && isEnumType(type)) {
            enumsUsed.add(typeName);
        }
    }
}
