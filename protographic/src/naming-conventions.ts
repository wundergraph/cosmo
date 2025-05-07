import { camelCase, snakeCase, upperFirst } from 'lodash';

/**
 * Shared naming conventions for converting GraphQL to Protocol Buffers
 * 
 * This utility file ensures consistent naming transformations between
 * the Proto compiler and mapping compiler implementations.
 */

/**
 * The names of the GraphQL operation types
 */
export type OperationTypeName = 'Query' | 'Mutation' | 'Subscription';

/**
 * Converts a GraphQL field name to a Protocol Buffer field name (snake_case)
 */
export function graphqlFieldToProtoField(fieldName: string): string {
  return snakeCase(fieldName);
}

/**
 * Converts a GraphQL argument name to a Protocol Buffer field name (snake_case)
 */
export function graphqlArgumentToProtoField(argName: string): string {
  return snakeCase(argName);
}

/**
 * Creates an operation method name from an operation type and field name
 */
export function createOperationMethodName(operationType: OperationTypeName, fieldName: string): string {
  return `${operationType}${upperFirst(camelCase(fieldName))}`;
}

/**
 * Creates a request message name for an operation
 */
export function createRequestMessageName(methodName: string): string {
  return `${methodName}Request`;
}

/**
 * Creates a response message name for an operation
 */
export function createResponseMessageName(methodName: string): string {
  return `${methodName}Response`;
}

/**
 * Creates an entity lookup method name for an entity type
 */
export function createEntityLookupMethodName(typeName: string): string {
  return `Lookup${typeName}ById`;
}

/**
 * Creates a request message name for an entity lookup
 */
export function createEntityLookupRequestName(typeName: string): string {
  return `Lookup${typeName}ByIdRequest`;
}

/**
 * Creates a response message name for an entity lookup
 */
export function createEntityLookupResponseName(typeName: string): string {
  return `Lookup${typeName}ByIdResponse`;
}

/**
 * Creates a result message name for an entity lookup
 */
export function createEntityLookupResultName(typeName: string): string {
  return `Lookup${typeName}ByIdResult`;
}

/**
 * Converts a GraphQL enum value to a Protocol Buffer enum value
 */
export function graphqlEnumValueToProtoEnumValue(enumTypeName: string, enumValue: string): string {
  return `${enumTypeName.toUpperCase()}_${enumValue}`;
}

/**
 * Creates a Proto enum unspecified value (required as first value in proto3)
 */
export function createEnumUnspecifiedValue(enumTypeName: string): string {
  return `${enumTypeName.toUpperCase()}_UNSPECIFIED`;
} 