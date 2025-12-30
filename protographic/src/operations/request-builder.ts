import protobuf from 'protobufjs';
import {
  VariableDefinitionNode,
  GraphQLSchema,
  GraphQLInputType,
  TypeNode,
  isInputObjectType,
  isEnumType,
  getNamedType,
  GraphQLInputObjectType,
  GraphQLEnumType,
  typeFromAST,
} from 'graphql';
import { mapGraphQLTypeToProto } from './type-mapper.js';
import { assignFieldNumbersFromLockData, FieldNumberManager } from './field-numbering.js';
import {
  graphqlFieldToProtoField,
  graphqlArgumentToProtoField,
  createEnumUnspecifiedValue,
  graphqlEnumValueToProtoEnumValue,
  protoFieldToProtoJSON,
} from '../naming-conventions.js';
import { GRAPHQL_VARIABLE_NAME } from './proto-field-options.js';

/**
 * Options for building request messages
 */
export interface RequestBuilderOptions {
  /** Whether to include comments/descriptions */
  includeComments?: boolean;
  /** Field number manager for consistent numbering */
  fieldNumberManager?: FieldNumberManager;
  /** The GraphQL schema for type lookups */
  schema?: GraphQLSchema;
  /** Custom scalar type mappings (scalar name -> proto type) */
  customScalarMappings?: Record<string, string>;
  /** Callback to ensure nested list wrapper messages are created */
  ensureNestedListWrapper?: (graphqlType: GraphQLInputType) => string;
}

/**
 * Builds a Protocol Buffer request message from GraphQL operation variables
 *
 * @param messageName - The name for the request message
 * @param variables - Array of variable definitions from the operation
 * @param schema - The GraphQL schema for type resolution
 * @param options - Optional configuration
 * @returns A protobuf Type object representing the request message
 */
export function buildRequestMessage(
  messageName: string,
  variables: ReadonlyArray<VariableDefinitionNode>,
  schema: GraphQLSchema,
  options?: RequestBuilderOptions,
): protobuf.Type {
  const message = new protobuf.Type(messageName);
  const fieldNumberManager = options?.fieldNumberManager;

  // Collect all variable names
  const variableNames = variables.map((v) => graphqlArgumentToProtoField(v.variable.name.value));

  // Reconcile field order using lock manager if available
  let orderedVariableNames = variableNames;
  if (fieldNumberManager && 'reconcileFieldOrder' in fieldNumberManager) {
    orderedVariableNames = fieldNumberManager.reconcileFieldOrder(messageName, variableNames);
  }

  // Create a map for quick lookup
  const variableMap = new Map<string, VariableDefinitionNode>();
  for (const variable of variables) {
    const protoName = graphqlArgumentToProtoField(variable.variable.name.value);
    variableMap.set(protoName, variable);
  }

  // Pre-assign field numbers from lock data if available
  assignFieldNumbersFromLockData(messageName, orderedVariableNames, fieldNumberManager);

  // Process variables in reconciled order
  let fieldNumber = 1;
  for (const protoVariableName of orderedVariableNames) {
    const variable = variableMap.get(protoVariableName);
    if (!variable) continue;

    const variableName = variable.variable.name.value;
    const field = buildVariableField(variableName, variable.type, schema, messageName, options, fieldNumber);

    if (field) {
      message.add(field);
      fieldNumber++;
    }
  }

  return message;
}

/**
 * Builds a proto field from a GraphQL variable definition
 *
 * @param variableName - The name of the variable
 * @param typeNode - The GraphQL type node from the variable definition
 * @param schema - The GraphQL schema for type resolution
 * @param messageName - The name of the message this field belongs to
 * @param options - Optional configuration
 * @param defaultFieldNumber - Default field number if no manager is provided
 * @returns A protobuf Field object
 */
export function buildVariableField(
  variableName: string,
  typeNode: TypeNode,
  schema: GraphQLSchema,
  messageName: string,
  options?: RequestBuilderOptions,
  defaultFieldNumber: number = 1,
): protobuf.Field | null {
  const protoFieldName = graphqlArgumentToProtoField(variableName);
  const fieldNumberManager = options?.fieldNumberManager;

  // Convert TypeNode to GraphQLType for mapping
  const graphqlType = typeNodeToGraphQLType(typeNode, schema);
  if (!graphqlType) {
    return null;
  }

  const typeInfo = mapGraphQLTypeToProto(graphqlType, {
    customScalarMappings: options?.customScalarMappings,
  });

  // Handle nested list wrappers
  let finalTypeName = typeInfo.typeName;
  let isRepeated = typeInfo.isRepeated;

  if (typeInfo.requiresNestedWrapper && options?.ensureNestedListWrapper) {
    // Create wrapper message and use its name
    finalTypeName = options.ensureNestedListWrapper(graphqlType);
    isRepeated = false; // Wrapper handles the repetition
  }

  // Get field number - check if already assigned from reconciliation
  const existingFieldNumber = fieldNumberManager?.getFieldNumber(messageName, protoFieldName);

  let fieldNumber: number;
  if (existingFieldNumber !== undefined) {
    // Use existing field number from reconciliation
    fieldNumber = existingFieldNumber;
  } else if (fieldNumberManager) {
    // Get next field number and assign it
    fieldNumber = fieldNumberManager.getNextFieldNumber(messageName);
    fieldNumberManager.assignFieldNumber(messageName, protoFieldName, fieldNumber);
  } else {
    // No field number manager, use default
    fieldNumber = defaultFieldNumber;
  }

  const field = new protobuf.Field(protoFieldName, fieldNumber, finalTypeName);

  if (isRepeated) {
    field.repeated = true;
  }

  // Add wundergraph.connectrpc.graphql_variable_name option if the GraphQL variable name doesn't match
  // the expected protobuf JSON format (camelCase of snake_case field name)
  const expectedProtoJSON = protoFieldToProtoJSON(protoFieldName);
  if (variableName !== expectedProtoJSON) {
  	// Store the GraphQL variable name as a custom option
  	// This will be used by the handler to map proto JSON to GraphQL variables
  	if (!field.options) {
  		field.options = {};
  	}
  	field.options[GRAPHQL_VARIABLE_NAME.optionName] = variableName;
  }

  return field;
}

/**
 * Builds an input object message type from a GraphQL input object type
 *
 * @param inputType - The GraphQL input object type
 * @param options - Optional configuration
 * @returns A protobuf Type object
 */
export function buildInputObjectMessage(
  inputType: GraphQLInputObjectType,
  options?: RequestBuilderOptions,
): protobuf.Type {
  const message = new protobuf.Type(inputType.name);
  const fieldNumberManager = options?.fieldNumberManager;
  const fields = inputType.getFields();

  // Collect all field names
  const fieldNames = Object.keys(fields).map((name) => graphqlFieldToProtoField(name));

  // Reconcile field order using lock manager if available
  let orderedFieldNames = fieldNames;
  if (fieldNumberManager && 'reconcileFieldOrder' in fieldNumberManager) {
    orderedFieldNames = fieldNumberManager.reconcileFieldOrder(message.name, fieldNames);
  }

  // Create a map for quick lookup
  const fieldMap = new Map<string, (typeof fields)[string]>();
  for (const [fieldName, inputField] of Object.entries(fields)) {
    const protoFieldName = graphqlFieldToProtoField(fieldName);
    fieldMap.set(protoFieldName, inputField);
  }

  // Pre-assign field numbers from lock data if available
  assignFieldNumbersFromLockData(message.name, orderedFieldNames, fieldNumberManager);

  // Process fields in reconciled order
  for (const protoFieldName of orderedFieldNames) {
    const inputField = fieldMap.get(protoFieldName);
    if (!inputField) continue;

    const typeInfo = mapGraphQLTypeToProto(inputField.type, {
      customScalarMappings: options?.customScalarMappings,
    });

    // Handle nested list wrappers
    let finalTypeName = typeInfo.typeName;
    let isRepeated = typeInfo.isRepeated;

    if (typeInfo.requiresNestedWrapper && options?.ensureNestedListWrapper) {
      // Create wrapper message and use its name
      finalTypeName = options.ensureNestedListWrapper(inputField.type);
      isRepeated = false; // Wrapper handles the repetition
    }

    // Get field number - check if already assigned from reconciliation
    let fieldNumber = fieldNumberManager?.getFieldNumber(message.name, protoFieldName);

    if (fieldNumber === undefined && fieldNumberManager) {
      fieldNumber = fieldNumberManager.getNextFieldNumber(message.name);
      fieldNumberManager.assignFieldNumber(message.name, protoFieldName, fieldNumber);
    } else if (fieldNumber === undefined) {
      fieldNumber = orderedFieldNames.indexOf(protoFieldName) + 1;
    }

    const field = new protobuf.Field(protoFieldName, fieldNumber, finalTypeName);

    if (isRepeated) {
      field.repeated = true;
    }

    if (options?.includeComments && inputField.description) {
      field.comment = inputField.description;
    }

    message.add(field);
  }

  return message;
}

/**
 * Builds an enum type from a GraphQL enum type
 *
 * @param enumType - The GraphQL enum type
 * @param options - Optional configuration
 * @returns A protobuf Enum object
 */
export function buildEnumType(enumType: GraphQLEnumType, options?: RequestBuilderOptions): protobuf.Enum {
  const protoEnum = new protobuf.Enum(enumType.name);

  // Proto3 requires the first enum value to be 0 (unspecified)
  // Use prefixed UNSPECIFIED to avoid collisions when multiple enums are in the same scope
  const unspecifiedValue = createEnumUnspecifiedValue(enumType.name);
  protoEnum.add(unspecifiedValue, 0);

  let enumNumber = 1;
  const enumValues = enumType.getValues();
  for (const enumValue of enumValues) {
    // Prefix enum values with the enum type name to avoid collisions
    const protoEnumValue = graphqlEnumValueToProtoEnumValue(enumType.name, enumValue.name);
    protoEnum.add(protoEnumValue, enumNumber);

    // Note: protobufjs doesn't have direct comment support for enum values
    // In a full implementation, you'd track these separately for text generation

    enumNumber++;
  }

  return protoEnum;
}

/**
 * Helper to convert a GraphQL TypeNode to a GraphQLType
 * Uses GraphQL's built-in typeFromAST to properly handle NonNull and List wrappers
 */
function typeNodeToGraphQLType(typeNode: TypeNode, schema: GraphQLSchema): GraphQLInputType | null {
  return typeFromAST(schema, typeNode) as GraphQLInputType | null;
}
