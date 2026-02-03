import { getNormalizedFieldSet, safeParse } from '@wundergraph/composition';
import { camelCase, snakeCase, upperFirst } from 'lodash-es';

/**
 * Shared naming conventions for converting GraphQL to Protocol Buffers
 *
 * This utility file ensures consistent naming transformations between
 * the Proto compiler and mapping compiler implementations.
 */

/**
 * The names of the GraphQL operation types
 */
export type OperationTypeName = 'Query' | 'Mutation' | 'Subscription' | 'Resolve';

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
 * Converts a proto field name (snake_case) to the expected protobuf JSON format (camelCase)
 * This matches how protobuf JSON marshaling automatically converts field names
 */
export function protoFieldToProtoJSON(protoFieldName: string): string {
  return camelCase(protoFieldName);
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
  const normalizedKey = createMethodSuffixFromEntityKey(keyString);
  return `Lookup${typeName}${normalizedKey}`;
}

/**
 * Creates a key message name for an entity lookup request
 * @param typeName - The name of the entity type
 * @param keyString - The key string
 * @returns The name of the key message
 */
export function createEntityLookupRequestKeyMessageName(typeName: string, keyString: string = 'id'): string {
  const requestName = createRequestMessageName(createEntityLookupMethodName(typeName, keyString));
  return `${requestName}Key`;
}

/**
 * Creates a required fields method name for an entity type.
 * The fields are sorted alphabetically.
 * @param typeName - The name of the entity type
 * @param fieldName - The name of the field that is required
 * @param keyString - The key string
 * @returns The name of the required fields method
 * @example
 * createRequiredFieldsMethodName('User', 'post', 'id') // => 'RequireUserPostById'
 * createRequiredFieldsMethodName('User', 'post', 'id name') // => 'RequireUserPostByIdAndName'
 * createRequiredFieldsMethodName('User', 'post', 'name,id') // => 'RequireUserPostByIdAndName'
 */
export function createRequiredFieldsMethodName(typeName: string, fieldName: string, keyString: string = 'id'): string {
  const normalizedKey = createMethodSuffixFromEntityKey(keyString);
  return `Require${typeName}${upperFirst(camelCase(fieldName))}${normalizedKey}`;
}

/**
 * Creates a method suffix from an entity key string
 * @param keyString - The key string
 * @returns The method suffix
 */
export function createMethodSuffixFromEntityKey(keyString: string = 'id'): string {
  const normalizedKey = formatKeyElements(keyString).join('And');

  return `By${normalizedKey}`;
}

/**
 * Normalizes a key string into a canonical field set representation.
 *
 * Parses the key string as a GraphQL selection set and applies normalization
 * logic from the composition package to produce a consistent string representation.
 * @remarks We currently don't support nested keys, so we apply a simple deduplication logic.
 *
 * @param keyString - The key string from a @key directive (e.g., "id name", "id,name")
 * @returns The normalized field set string
 * @throws Error if the key string cannot be parsed as a valid GraphQL selection
 *
 * @example
 * normalizeKeyString('id name')     // => 'id name'
 * normalizeKeyString('name id')     // => 'id name' (sorted)
 * normalizeKeyString('id,name')     // => 'id name'
 */
export function normalizeKeyString(keyString: string): string {
  const { error, documentNode } = safeParse('{' + keyString + '}');
  if (error || !documentNode) {
    throw new Error(`Invalid field set for key directive: ${keyString} - error: ${error?.message}`);
  }

  const normalizedFieldSet = getNormalizedFieldSet(documentNode);
  return [...new Set(normalizedFieldSet.split(/[,\s]+/))].join(' ');
}

/**
 * Formats key elements into PascalCase.
 *
 * This function normalizes a key string, splits it into individual field names,
 * converts each to PascalCase. Used primarily for generating consistent method name suffixes from entity keys.
 *
 * @param keyString - The key string from a @key directive (e.g., "id name", "user_id,name")
 * @returns Array of PascalCase field names
 *
 * @example
 * formatKeyElements('id,name')       // => ['Id', 'Name']
 * formatKeyElements('name,id')       // => ['Id', 'Name']
 * formatKeyElements('name id name')  // => ['Id', 'Name']
 * formatKeyElements('user_id')       // => ['UserId']
 */
export function formatKeyElements(keyString: string): string[] {
  return normalizeKeyString(keyString)
    .split(/[,\s]+/)
    .map((field) => upperFirst(camelCase(field)));
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
 * Creates a response result name for a resolver response
 * @param methodName - The name of the method
 * @returns The name of the response result built from the method name
 */
export function resolverResponseResultName(methodName: string): string {
  return `${upperFirst(camelCase(methodName))}Result`;
}

/**
 * Creates a type field arguments name for a type field
 * @param methodName - The method name
 * @returns The name of the type field arguments built from the method name
 */
export function typeFieldArgsName(methodName: string): string {
  return `${methodName}Args`;
}

/**
 * Creates a type field context name for a type field
 * @param methodName - The method name
 * @returns The name of the type field context built from the method name
 */
export function typeFieldContextName(methodName: string): string {
  return `${methodName}Context`;
}
