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
  FragmentSpreadNode,
  isInterfaceType,
  isUnionType,
} from 'graphql';
import { mapGraphQLTypeToProto, ProtoTypeInfo } from './type-mapper.js';
import { FieldNumberManager } from './field-numbering.js';
import { graphqlFieldToProtoField } from '../naming-conventions.js';
import { upperFirst, camelCase } from 'lodash-es';

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
  /** Map of fragment definitions for resolving fragment spreads */
  fragments?: Map<string, FragmentDefinitionNode>;
  /** Schema for type lookups */
  schema?: GraphQLSchema;
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
      // For unions, fields can only be selected via inline fragments
      // For interfaces and objects, we can select fields directly
      if (isObjectType(parentType) || isInterfaceType(parentType)) {
        processFieldSelection(
          selection,
          message,
          parentType as any, // interfaces also have getFields()
          typeInfo,
          options,
          fieldNumberManager,
        );
      }
      // For unions, skip - fields will come from inline fragments
    } else if (selection.kind === 'InlineFragment') {
      processInlineFragment(
        selection,
        message,
        parentType,
        typeInfo,
        options,
        fieldNumberManager,
      );
    } else if (selection.kind === 'FragmentSpread') {
      processFragmentSpread(
        selection,
        message,
        parentType,
        typeInfo,
        options,
        fieldNumberManager,
      );
    }
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
  
  // Check if field already exists in the message (avoid duplicates)
  if (message.fields[protoFieldName]) {
    return; // Field already added, skip
  }
  
  // Get the field definition from the parent type
  const fieldDef = parentType.getFields()[fieldName];
  if (!fieldDef) {
    return; // Skip unknown fields
  }
  
  const fieldType = fieldDef.type;
  
  // If the field has a selection set, we need a nested message
  if (field.selectionSet) {
    const namedType = getNamedType(fieldType);
    if (isObjectType(namedType) || isInterfaceType(namedType) || isUnionType(namedType)) {
      const nestedMessageName = `${message.name}${upperFirst(camelCase(fieldName))}`;
      
      // For interfaces and unions, we use the base type to collect fields from inline fragments
      // For object types, we process normally
      const typeForSelection = isObjectType(namedType) ? namedType : namedType as any;
      
      const nestedMessage = buildMessageFromSelectionSet(
        nestedMessageName,
        field.selectionSet,
        typeForSelection,
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
 * Inline fragments allow type-specific field selections on interfaces/unions
 */
function processInlineFragment(
  fragment: InlineFragmentNode,
  message: protobuf.Type,
  parentType: GraphQLObjectType,
  typeInfo: TypeInfo,
  options?: MessageBuilderOptions,
  fieldNumberManager?: FieldNumberManager,
): void {
  // Determine the type for this inline fragment
  let fragmentType: GraphQLObjectType;
  
  if (fragment.typeCondition) {
    // Type condition specified: ... on User
    const typeName = fragment.typeCondition.name.value;
    const schema = options?.schema;
    
    if (!schema) {
      // Without schema, we can't resolve the type - skip
      return;
    }
    
    const type = schema.getType(typeName);
    if (!type || !isObjectType(type)) {
      // Type not found or not an object type - skip
      return;
    }
    
    fragmentType = type;
  } else {
    // No type condition: just process with parent type
    fragmentType = parentType;
  }
  
  // Process all selections in the inline fragment with the resolved type
  if (fragment.selectionSet) {
    for (const selection of fragment.selectionSet.selections) {
      if (selection.kind === 'Field') {
        processFieldSelection(
          selection,
          message,
          fragmentType,
          typeInfo,
          options,
          fieldNumberManager,
        );
      } else if (selection.kind === 'InlineFragment') {
        // Nested inline fragment
        processInlineFragment(
          selection,
          message,
          fragmentType,
          typeInfo,
          options,
          fieldNumberManager,
        );
      } else if (selection.kind === 'FragmentSpread') {
        processFragmentSpread(
          selection,
          message,
          fragmentType,
          typeInfo,
          options,
          fieldNumberManager,
        );
      }
    }
  }
}

/**
 * Processes a fragment spread and adds its selections to the message
 * Fragment spreads reference named fragment definitions
 */
function processFragmentSpread(
  spread: FragmentSpreadNode,
  message: protobuf.Type,
  parentType: GraphQLObjectType,
  typeInfo: TypeInfo,
  options?: MessageBuilderOptions,
  fieldNumberManager?: FieldNumberManager,
): void {
  const fragmentName = spread.name.value;
  const fragments = options?.fragments;
  
  if (!fragments) {
    // No fragments provided - skip
    return;
  }
  
  const fragmentDef = fragments.get(fragmentName);
  if (!fragmentDef) {
    // Fragment definition not found - skip
    return;
  }
  
  // Resolve the fragment's type condition
  const typeName = fragmentDef.typeCondition.name.value;
  const schema = options?.schema;
  
  if (!schema) {
    // Without schema, we can't resolve the type - skip
    return;
  }
  
  const type = schema.getType(typeName);
  if (!type || !isObjectType(type)) {
    // Type not found or not an object type - skip
    return;
  }
  
  // Process the fragment's selection set with the resolved type
  for (const selection of fragmentDef.selectionSet.selections) {
    if (selection.kind === 'Field') {
      processFieldSelection(
        selection,
        message,
        type,
        typeInfo,
        options,
        fieldNumberManager,
      );
    } else if (selection.kind === 'InlineFragment') {
      processInlineFragment(
        selection,
        message,
        type,
        typeInfo,
        options,
        fieldNumberManager,
      );
    } else if (selection.kind === 'FragmentSpread') {
      // Nested fragment spread (fragment inside fragment)
      processFragmentSpread(
        selection,
        message,
        type,
        typeInfo,
        options,
        fieldNumberManager,
      );
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

