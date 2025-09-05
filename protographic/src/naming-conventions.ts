import { camelCase, lowerFirst, snakeCase, upperFirst } from 'lodash-es';

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

export function createResolverMethodName(parentTypeName: string, fieldName: string): string {
  return `Resolve${upperFirst(camelCase(parentTypeName))}${upperFirst(camelCase(fieldName))}`;
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
export function createEntityLookupMethodName(typeName: string, keyString: string = 'id'): string {
  const normalizedKey = keyString
    .split(/[,\s]+/)
    .filter((field) => field.length > 0)
    .map((field) => upperFirst(camelCase(field)))
    .sort()
    .join('And');

  return `Lookup${typeName}By${normalizedKey}`;
}

/**
 * Converts a GraphQL enum value to a Protocol Buffer enum value
 */
export function graphqlEnumValueToProtoEnumValue(enumTypeName: string, enumValue: string): string {
  return `${snakeCase(enumTypeName).toUpperCase()}_${enumValue}`;
}

/**
 * Creates a Proto enum unspecified value (required as first value in proto3)
 */
export function createEnumUnspecifiedValue(enumTypeName: string): string {
  return `${snakeCase(enumTypeName).toUpperCase()}_UNSPECIFIED`;
}

/**
 * Creates a operation arguments name for an operation
 * @param operationName - The name of the operation
 * @param fieldName - The name of the field
 * @returns The name of the operation arguments
 */
export function resolverRequestKeyName(requestName: string): string {
  return `${upperFirst(camelCase(requestName))}Key`;
}

/**
 * Creates a response result name for a resolver response
 * @param responseName - The name of the response
 * @returns The name of the response result
 */
export function resolverResponseResultName(responseName: string): string {
  return `${upperFirst(camelCase(responseName))}Result`;
}

/**
 * Creates a type field arguments name for a type field
 * @param typeName - The name of the type
 * @param fieldName - The name of the field
 * @returns The name of the type field arguments
 */
export function typeFieldArgsName(typeName: string, fieldName: string): string {
  return `${upperFirst(camelCase(typeName))}${upperFirst(camelCase(fieldName))}Args`;
}

/**
 * Creates a proto field name that combines the parent type name and field name
 * @param parentTypeName - The name of the parent type
 * @param fieldName - The name of the field
 * @returns The name of the proto field
 */
export function parentTypeNameProtoField(parentTypeName: string, fieldName: string): string {
  return snakeCase(`${upperFirst(camelCase(parentTypeName))}${upperFirst(camelCase(fieldName))}`);
}
