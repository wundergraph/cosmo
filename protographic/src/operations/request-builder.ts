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
import { FieldNumberManager } from './field-numbering.js';
import {
  graphqlFieldToProtoField,
  graphqlArgumentToProtoField,
  createEnumUnspecifiedValue,
  graphqlEnumValueToProtoEnumValue,
} from '../naming-conventions.js';

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
  if (fieldNumberManager?.getLockManager) {
    const lockManager = fieldNumberManager.getLockManager();
    if (lockManager) {
      const lockData = lockManager.getLockData();
      if (lockData.messages[messageName]) {
        const messageData = lockData.messages[messageName];
        for (const protoVariableName of orderedVariableNames) {
          const fieldNumber = messageData.fields[protoVariableName];
          if (fieldNumber !== undefined) {
            fieldNumberManager.assignFieldNumber(messageName, protoVariableName, fieldNumber);
          }
        }
      }
    }
  }

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
 * Create a protobuf field representing a GraphQL operation variable.
 *
 * @param variableName - GraphQL variable name to convert to a proto field name
 * @param typeNode - GraphQL TypeNode for the variable
 * @param schema - Schema used to resolve the GraphQL type
 * @param messageName - Protobuf message name that will contain the field (used for field-number reconciliation)
 * @param options - Optional builder settings (field numbering, custom scalar mappings, nested-list wrapper hook)
 * @param defaultFieldNumber - Fallback field number when no field-number manager is present
 * @returns A `protobuf.Field` for the variable, or `null` if the GraphQL type could not be resolved
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

  return field;
}

/**
 * Create a protobuf Type that represents the given GraphQL input object type.
 *
 * The returned Type contains fields corresponding to the GraphQL input fields, with proto field
 * names and types mapped from GraphQL types, field numbers assigned or reconciled via a
 * FieldNumberManager if provided, optional nested-list wrapper handling, and optional field
 * comments when enabled.
 *
 * @param inputType - The GraphQL input object type to convert
 * @param options - Optional configuration (e.g., includeComments, fieldNumberManager,
 *                  customScalarMappings, ensureNestedListWrapper)
 * @returns A protobuf Type whose fields mirror the GraphQL input object's fields with mapped
 *          proto types and assigned field numbers
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
  if (fieldNumberManager?.getLockManager) {
    const lockManager = fieldNumberManager.getLockManager();
    if (lockManager) {
      const lockData = lockManager.getLockData();
      if (lockData.messages[message.name]) {
        const messageData = lockData.messages[message.name];
        for (const protoFieldName of orderedFieldNames) {
          const fieldNumber = messageData.fields[protoFieldName];
          if (fieldNumber !== undefined) {
            fieldNumberManager.assignFieldNumber(message.name, protoFieldName, fieldNumber);
          }
        }
      }
    }
  }

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

    if (options?.includeComments && enumValue.description) {
      // Note: protobufjs doesn't have direct comment support for enum values
      // In a full implementation, you'd track these separately for text generation
    }

    enumNumber++;
  }

  return protoEnum;
}

/**
 * Convert a GraphQL TypeNode into the corresponding GraphQL input type.
 *
 * @returns The resolved GraphQLInputType, or `null` if the node cannot be resolved against the provided schema.
 */
function typeNodeToGraphQLType(typeNode: TypeNode, schema: GraphQLSchema): GraphQLInputType | null {
  return typeFromAST(schema, typeNode) as GraphQLInputType | null;
}
