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
import { graphqlFieldToProtoField, graphqlArgumentToProtoField } from '../naming-conventions.js';

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
  
  let fieldNumber = 1;
  for (const variable of variables) {
    const variableName = variable.variable.name.value;
    const field = buildVariableField(
      variableName,
      variable.type,
      schema,
      messageName,
      options,
      fieldNumber,
    );
    
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
  
  const typeInfo = mapGraphQLTypeToProto(graphqlType);
  
  // Get field number
  const fieldNumber = fieldNumberManager
    ? fieldNumberManager.getNextFieldNumber(messageName)
    : defaultFieldNumber;
  
  if (fieldNumberManager) {
    fieldNumberManager.assignFieldNumber(messageName, protoFieldName, fieldNumber);
  }
  
  const field = new protobuf.Field(
    protoFieldName,
    fieldNumber,
    typeInfo.typeName,
  );
  
  if (typeInfo.isRepeated) {
    field.repeated = true;
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
  
  for (const [fieldName, inputField] of Object.entries(fields)) {
    const protoFieldName = graphqlFieldToProtoField(fieldName);
    const typeInfo = mapGraphQLTypeToProto(inputField.type);
    
    // Get field number
    const fieldNumber = fieldNumberManager
      ? fieldNumberManager.getNextFieldNumber(message.name)
      : Object.keys(fields).indexOf(fieldName) + 1;
    
    if (fieldNumberManager) {
      fieldNumberManager.assignFieldNumber(message.name, protoFieldName, fieldNumber);
    }
    
    const field = new protobuf.Field(
      protoFieldName,
      fieldNumber,
      typeInfo.typeName,
    );
    
    if (typeInfo.isRepeated) {
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
export function buildEnumType(
  enumType: GraphQLEnumType,
  options?: RequestBuilderOptions,
): protobuf.Enum {
  const protoEnum = new protobuf.Enum(enumType.name);
  
  // Proto3 requires the first enum value to be 0 (unspecified)
  protoEnum.add('UNSPECIFIED', 0);
  
  let enumNumber = 1;
  const enumValues = enumType.getValues();
  for (const enumValue of enumValues) {
    protoEnum.add(enumValue.name, enumNumber);
    
    if (options?.includeComments && enumValue.description) {
      // Note: protobufjs doesn't have direct comment support for enum values
      // In a full implementation, you'd track these separately for text generation
    }
    
    enumNumber++;
  }
  
  return protoEnum;
}

/**
 * Helper to convert a GraphQL TypeNode to a GraphQLType
 * Uses GraphQL's built-in typeFromAST to properly handle NonNull and List wrappers
 */
function typeNodeToGraphQLType(
  typeNode: TypeNode,
  schema: GraphQLSchema,
): GraphQLInputType | null {
  return typeFromAST(schema, typeNode) as GraphQLInputType | null;
}

