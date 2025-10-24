import * as protobuf from 'protobufjs';
import {
  SelectionSetNode,
  FieldNode,
  GraphQLObjectType,
  GraphQLType,
  GraphQLSchema,
  TypeInfo,
  isObjectType,
  getNamedType,
  InlineFragmentNode,
  FragmentDefinitionNode,
  GraphQLOutputType,
} from 'graphql';
import { mapGraphQLTypeToProto, ProtoTypeInfo } from './type-mapper.js';
import { FieldNumberManager } from './field-numbering.js';
import { graphqlFieldToProtoField } from '../naming-conventions.js';

/**
 * Options for building proto messages
 */
export interface MessageBuilderOptions {
  /** Whether to include comments/descriptions */
  includeComments?: boolean;
  /** Root object for adding nested types */
  root?: protobuf.Root;
  /** Field number manager for consistent numbering */
  fieldNumberManager?: FieldNumberManager;
}

/**
 * Builds a Protocol Buffer message type from a GraphQL selection set
 *
 * @param messageName - The name for the proto message
 * @param selectionSet - The GraphQL selection set to convert
 * @param parentType - The GraphQL type that contains these selections
 * @param typeInfo - TypeInfo for resolving field types
 * @param options - Optional configuration
 * @returns A protobuf Type object
 */
export function buildMessageFromSelectionSet(
  messageName: string,
  selectionSet: SelectionSetNode,
  parentType: GraphQLObjectType,
  typeInfo: TypeInfo,
  options?: MessageBuilderOptions,
): protobuf.Type {
  const message = new protobuf.Type(messageName);
  const fieldNumberManager = options?.fieldNumberManager;
  
  // Process each selection in the set
  for (const selection of selectionSet.selections) {
    if (selection.kind === 'Field') {
      processFieldSelection(
        selection,
        message,
        parentType,
        typeInfo,
        options,
        fieldNumberManager,
      );
    } else if (selection.kind === 'InlineFragment') {
      processInlineFragment(
        selection,
        message,
        typeInfo,
        options,
        fieldNumberManager,
      );
    }
    // FragmentSpread would need fragment definitions to be passed in
    // For now we'll skip it, but could be added later
  }
  
  return message;
}

/**
 * Processes a field selection and adds it to the message
 */
function processFieldSelection(
  field: FieldNode,
  message: protobuf.Type,
  parentType: GraphQLObjectType,
  typeInfo: TypeInfo,
  options?: MessageBuilderOptions,
  fieldNumberManager?: FieldNumberManager,
): void {
  const fieldName = field.name.value;
  const protoFieldName = graphqlFieldToProtoField(fieldName);
  
  // Get the field definition from the parent type
  const fieldDef = parentType.getFields()[fieldName];
  if (!fieldDef) {
    return; // Skip unknown fields
  }
  
  const fieldType = fieldDef.type;
  
  // If the field has a selection set, we need a nested message
  if (field.selectionSet) {
    const namedType = getNamedType(fieldType);
    if (isObjectType(namedType)) {
      const nestedMessageName = `${message.name}_${fieldName}`;
      const nestedMessage = buildMessageFromSelectionSet(
        nestedMessageName,
        field.selectionSet,
        namedType,
        typeInfo,
        options,
      );
      
      // Add nested message to the parent message
      message.add(nestedMessage);
      
      // Get field number
      const fieldNumber = fieldNumberManager
        ? fieldNumberManager.getNextFieldNumber(message.name)
        : message.fieldsArray.length + 1;
      
      if (fieldNumberManager) {
        fieldNumberManager.assignFieldNumber(message.name, protoFieldName, fieldNumber);
      }
      
      // Determine if field should be repeated
      const protoTypeInfo = mapGraphQLTypeToProto(fieldType);
      
      const protoField = new protobuf.Field(
        protoFieldName,
        fieldNumber,
        nestedMessageName,
      );
      
      if (protoTypeInfo.isRepeated) {
        protoField.repeated = true;
      }
      
      if (options?.includeComments && fieldDef.description) {
        protoField.comment = fieldDef.description;
      }
      
      message.add(protoField);
    }
  } else {
    // Scalar or enum field
    const protoTypeInfo = mapGraphQLTypeToProto(fieldType);
    
    // Get field number
    const fieldNumber = fieldNumberManager
      ? fieldNumberManager.getNextFieldNumber(message.name)
      : message.fieldsArray.length + 1;
    
    if (fieldNumberManager) {
      fieldNumberManager.assignFieldNumber(message.name, protoFieldName, fieldNumber);
    }
    
    const protoField = new protobuf.Field(
      protoFieldName,
      fieldNumber,
      protoTypeInfo.typeName,
    );
    
    if (protoTypeInfo.isRepeated) {
      protoField.repeated = true;
    }
    
    if (options?.includeComments && fieldDef.description) {
      protoField.comment = fieldDef.description;
    }
    
    message.add(protoField);
  }
}

/**
 * Processes an inline fragment and adds its selections to the message
 */
function processInlineFragment(
  fragment: InlineFragmentNode,
  message: protobuf.Type,
  typeInfo: TypeInfo,
  options?: MessageBuilderOptions,
  fieldNumberManager?: FieldNumberManager,
): void {
  // For inline fragments, we need to get the type condition
  if (!fragment.typeCondition) {
    return;
  }
  
  const typeName = fragment.typeCondition.name.value;
  const schema = typeInfo.getParentType();
  
  // This is a simplified version - in a full implementation,
  // you'd need to look up the type from the schema and process accordingly
  // For now, we'll just process the selections
  if (fragment.selectionSet) {
    for (const selection of fragment.selectionSet.selections) {
      if (selection.kind === 'Field') {
        // Would need parent type here - skipping for now
        // In a full implementation, look up the type from the schema
      }
    }
  }
}

/**
 * Builds a field definition for a proto message
 *
 * @param fieldName - The name of the field
 * @param fieldType - The GraphQL type of the field
 * @param fieldNumber - The proto field number
 * @param options - Optional configuration
 * @returns A protobuf Field object
 */
export function buildFieldDefinition(
  fieldName: string,
  fieldType: GraphQLType,
  fieldNumber: number,
  options?: MessageBuilderOptions,
): protobuf.Field {
  const protoFieldName = graphqlFieldToProtoField(fieldName);
  const typeInfo = mapGraphQLTypeToProto(fieldType);
  
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
 * Builds a nested message type
 *
 * @param messageName - The name for the nested message
 * @param fields - Map of field names to their GraphQL types
 * @param options - Optional configuration
 * @returns A protobuf Type object
 */
export function buildNestedMessage(
  messageName: string,
  fields: Map<string, GraphQLType>,
  options?: MessageBuilderOptions,
): protobuf.Type {
  const message = new protobuf.Type(messageName);
  const fieldNumberManager = options?.fieldNumberManager;
  
  let fieldNumber = 1;
  for (const [fieldName, fieldType] of fields.entries()) {
    const protoFieldName = graphqlFieldToProtoField(fieldName);
    
    if (fieldNumberManager) {
      fieldNumber = fieldNumberManager.getNextFieldNumber(messageName);
      fieldNumberManager.assignFieldNumber(messageName, protoFieldName, fieldNumber);
    }
    
    const field = buildFieldDefinition(fieldName, fieldType, fieldNumber, options);
    message.add(field);
    
    if (!fieldNumberManager) {
      fieldNumber++;
    }
  }
  
  return message;
}

