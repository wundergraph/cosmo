import protobuf from 'protobufjs';
import {
  SelectionSetNode,
  SelectionNode,
  FieldNode,
  GraphQLObjectType,
  GraphQLType,
  GraphQLSchema,
  TypeInfo,
  isObjectType,
  isEnumType,
  getNamedType,
  InlineFragmentNode,
  FragmentDefinitionNode,
  GraphQLOutputType,
  GraphQLEnumType,
  FragmentSpreadNode,
  isInterfaceType,
  isUnionType,
  GraphQLInterfaceType,
  GraphQLUnionType,
} from 'graphql';
import { mapGraphQLTypeToProto, ProtoTypeInfo } from './type-mapper.js';
import { FieldNumberManager } from './field-numbering.js';
import { graphqlFieldToProtoField } from '../naming-conventions.js';
import { buildEnumType } from './request-builder.js';
import { upperFirst, camelCase } from 'lodash-es';

/**
 * Default maximum recursion depth to prevent stack overflow
 */
const DEFAULT_MAX_DEPTH = 50;

/**
 * Default starting depth for recursion tracking
 */
const DEFAULT_STARTING_DEPTH = 0;

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
  /** Set to track created enums (to avoid duplicates) */
  createdEnums?: Set<string>;
  /** Custom scalar type mappings (scalar name -> proto type) */
  customScalarMappings?: Record<string, string>;
  /** Maximum recursion depth to prevent stack overflow (default: 50) */
  maxDepth?: number;
  /** Internal: Current recursion depth */
  _depth?: number;
  /** Callback to ensure nested list wrapper messages are created */
  ensureNestedListWrapper?: (graphqlType: GraphQLOutputType) => string;
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
  parentType: GraphQLObjectType | GraphQLInterfaceType | GraphQLUnionType,
  typeInfo: TypeInfo,
  options?: MessageBuilderOptions,
): protobuf.Type {
  const message = new protobuf.Type(messageName);
  const fieldNumberManager = options?.fieldNumberManager;

  // First pass: collect all field names that will be in this message
  const fieldNames: string[] = [];
  const fieldSelections = new Map<string, { selection: FieldNode; type: GraphQLObjectType | GraphQLInterfaceType }>();

  // Maximum recursion depth to prevent stack overflow
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const currentDepth = options?._depth ?? DEFAULT_STARTING_DEPTH;

  // Check depth limit at the start of building each message
  if (currentDepth > maxDepth) {
    throw new Error(
      `Maximum recursion depth (${maxDepth}) exceeded while processing selection set. ` +
        `This may indicate deeply nested selections or circular fragment references. ` +
        `You can increase the limit using the maxDepth option.`,
    );
  }

  /**
   * Recursively collects fields from selections with protection against excessive recursion depth.
   *
   * Note: Circular fragment references are invalid GraphQL per the spec's NoFragmentCyclesRule.
   * GraphQL validation should catch these before reaching proto compilation.
   */
  const collectFields = (
    selections: readonly SelectionNode[],
    currentType: GraphQLObjectType | GraphQLInterfaceType | GraphQLUnionType,
    depth: number,
  ) => {
    // Stop condition: Check depth limit
    if (depth > maxDepth) {
      throw new Error(
        `Maximum recursion depth (${maxDepth}) exceeded while processing selection set. ` +
          `This may indicate deeply nested selections or circular fragment references. ` +
          `You can increase the limit using the maxDepth option.`,
      );
    }

    for (const selection of selections) {
      switch (selection.kind) {
        case 'Field':
          // Only object and interface types have fields that can be selected
          // Union types require inline fragments to access their constituent types
          if (isObjectType(currentType) || isInterfaceType(currentType)) {
            const fieldName = selection.name.value;
            const protoFieldName = graphqlFieldToProtoField(fieldName);
            if (!fieldNames.includes(protoFieldName)) {
              fieldNames.push(protoFieldName);
              fieldSelections.set(protoFieldName, { selection, type: currentType });
            }
          }
          break;

        case 'InlineFragment':
          if (selection.typeCondition && options?.schema) {
            const typeName = selection.typeCondition.name.value;
            const type = options.schema.getType(typeName);
            if (type && (isObjectType(type) || isInterfaceType(type))) {
              collectFields(selection.selectionSet.selections, type, depth + 1);
            }
          } else if (isObjectType(currentType) || isInterfaceType(currentType)) {
            // No type condition, but parent type supports fields
            collectFields(selection.selectionSet.selections, currentType, depth + 1);
          }
          break;

        case 'FragmentSpread':
          if (options?.fragments) {
            const fragmentDef = options.fragments.get(selection.name.value);
            if (fragmentDef && options?.schema) {
              const typeName = fragmentDef.typeCondition.name.value;
              const type = options.schema.getType(typeName);
              if (type && (isObjectType(type) || isInterfaceType(type))) {
                collectFields(fragmentDef.selectionSet.selections, type, depth + 1);
              }
            }
          }
          break;
      }
    }
  };

  // Collect fields from the selection set
  // For union types, only inline fragments will contribute fields (handled in collectFields)
  collectFields(selectionSet.selections, parentType, currentDepth);

  // Reconcile field order using lock manager if available
  let orderedFieldNames = fieldNames;
  if (fieldNumberManager && 'reconcileFieldOrder' in fieldNumberManager) {
    orderedFieldNames = fieldNumberManager.reconcileFieldOrder(messageName, fieldNames);
  }

  // Second pass: process fields in reconciled order
  // Pre-assign field numbers from lock data if available
  const lockManager = fieldNumberManager?.getLockManager();
  if (lockManager && fieldNumberManager) {
    const lockData = lockManager.getLockData();
    if (lockData.messages[messageName]) {
      const messageData = lockData.messages[messageName];
      for (const protoFieldName of orderedFieldNames) {
        const fieldNumber = messageData.fields[protoFieldName];
        if (fieldNumber !== undefined) {
          fieldNumberManager.assignFieldNumber(messageName, protoFieldName, fieldNumber);
        }
      }
    }
  }

  for (const protoFieldName of orderedFieldNames) {
    const fieldData = fieldSelections.get(protoFieldName);
    if (fieldData) {
      const fieldOptions = {
        ...options,
        _depth: currentDepth,
      };
      processFieldSelection(fieldData.selection, message, fieldData.type, typeInfo, fieldOptions, fieldNumberManager);
    }
  }

  return message;
}

/**
 * Add a GraphQL field selection to a protobuf message, creating nested messages or enums and assigning a field number.
 *
 * Handles fields with sub-selection sets by building and attaching nested messages, ensures enum types are added to the provided root once, applies list wrapper messages when required, and assigns or reconciles field numbers using the optional FieldNumberManager. Skips GraphQL introspection fields and union fields that must be handled via fragments.
 *
 * @param field - The GraphQL FieldNode to process
 * @param message - The protobuf.Type representing the parent message to which the field will be added
 * @param parentType - The GraphQL parent object/interface/union type that defines the field
 * @param typeInfo - GraphQL TypeInfo used for type resolution during processing
 * @param options - MessageBuilderOptions controlling comment inclusion, root enum registration, custom scalar mappings, depth tracking, and nested-list wrapper creation
 * @param fieldNumberManager - Optional manager used to obtain and reconcile protobuf field numbers for the message
 */
function processFieldSelection(
  field: FieldNode,
  message: protobuf.Type,
  parentType: GraphQLObjectType | GraphQLInterfaceType | GraphQLUnionType,
  typeInfo: TypeInfo,
  options?: MessageBuilderOptions,
  fieldNumberManager?: FieldNumberManager,
): void {
  const fieldName = field.name.value;

  // Skip __typename - it's a GraphQL introspection field that doesn't need to be in proto
  if (fieldName === '__typename') {
    return;
  }

  const protoFieldName = graphqlFieldToProtoField(fieldName);

  // Check if field already exists in the message (avoid duplicates)
  if (message.fields[protoFieldName]) {
    return; // Field already added, skip
  }

  // Get the field definition from the parent type
  // Union types don't have fields directly, so skip field validation for them
  if (isUnionType(parentType)) {
    // Union types should only be processed through inline fragments
    // This shouldn't happen in normal GraphQL, but we'll handle it gracefully
    return;
  }

  const fieldDef = parentType.getFields()[fieldName];
  if (!fieldDef) {
    throw new Error(
      `Field "${fieldName}" does not exist on type "${parentType.name}". ` +
        `GraphQL validation should be performed before proto compilation.`,
    );
  }

  const fieldType = fieldDef.type;

  // If the field has a selection set, we need a nested message
  if (field.selectionSet) {
    const namedType = getNamedType(fieldType);
    if (isObjectType(namedType) || isInterfaceType(namedType) || isUnionType(namedType)) {
      // Use simple name since message will be nested inside parent
      const nestedMessageName = upperFirst(camelCase(fieldName));

      // For interfaces and unions, we use the type directly for processing
      // Union types will only work with inline fragments that specify concrete types
      const typeForSelection = namedType;

      const nestedOptions = {
        ...options,
        _depth: (options?._depth ?? 0) + 1,
      };

      const nestedMessage = buildMessageFromSelectionSet(
        nestedMessageName,
        field.selectionSet,
        typeForSelection,
        typeInfo,
        nestedOptions,
      );

      // Add nested message to the parent message
      message.add(nestedMessage);

      // Get field number - check if already assigned from reconciliation
      const existingFieldNumber = fieldNumberManager?.getFieldNumber(message.name, protoFieldName);

      let fieldNumber: number;
      if (existingFieldNumber !== undefined) {
        // Use existing field number from reconciliation
        fieldNumber = existingFieldNumber;
      } else if (fieldNumberManager) {
        // Get next field number and assign it
        fieldNumber = fieldNumberManager.getNextFieldNumber(message.name);
        fieldNumberManager.assignFieldNumber(message.name, protoFieldName, fieldNumber);
      } else {
        // No field number manager, use sequential numbering
        fieldNumber = message.fieldsArray.length + 1;
      }

      // Determine if field should be repeated
      const protoTypeInfo = mapGraphQLTypeToProto(fieldType, {
        customScalarMappings: options?.customScalarMappings,
      });

      // Handle nested list wrappers for nested messages
      let finalTypeName = nestedMessageName;
      let isRepeated = protoTypeInfo.isRepeated;

      if (protoTypeInfo.requiresNestedWrapper && options?.ensureNestedListWrapper) {
        // Create wrapper message and use its name
        finalTypeName = options.ensureNestedListWrapper(fieldType) as any;
        isRepeated = false; // Wrapper handles the repetition
      }

      const protoField = new protobuf.Field(protoFieldName, fieldNumber, finalTypeName);

      if (isRepeated) {
        protoField.repeated = true;
      }

      if (options?.includeComments && fieldDef.description) {
        protoField.comment = fieldDef.description;
      }

      message.add(protoField);
    }
  } else {
    // Scalar or enum field
    const namedType = getNamedType(fieldType);

    // If this is an enum type, ensure it's added to the root
    if (isEnumType(namedType) && options?.root) {
      const enumTypeName = namedType.name;
      const createdEnums = options.createdEnums || new Set<string>();

      if (!createdEnums.has(enumTypeName)) {
        const protoEnum = buildEnumType(namedType as GraphQLEnumType, {
          includeComments: options.includeComments,
        });
        options.root.add(protoEnum);
        createdEnums.add(enumTypeName);

        // Update the set in options if it was provided
        if (options.createdEnums) {
          options.createdEnums.add(enumTypeName);
        }
      }
    }

    const protoTypeInfo = mapGraphQLTypeToProto(fieldType, {
      customScalarMappings: options?.customScalarMappings,
    });

    // Handle nested list wrappers
    let finalTypeName = protoTypeInfo.typeName;
    let isRepeated = protoTypeInfo.isRepeated;

    if (protoTypeInfo.requiresNestedWrapper && options?.ensureNestedListWrapper) {
      // Create wrapper message and use its name
      finalTypeName = options.ensureNestedListWrapper(fieldType) as any;
      isRepeated = false; // Wrapper handles the repetition
    }

    // Get field number - check if already assigned from reconciliation
    const existingFieldNumber = fieldNumberManager?.getFieldNumber(message.name, protoFieldName);

    let fieldNumber: number;
    if (existingFieldNumber !== undefined) {
      // Use existing field number from reconciliation
      fieldNumber = existingFieldNumber;
    } else if (fieldNumberManager) {
      // Get next field number and assign it
      fieldNumber = fieldNumberManager.getNextFieldNumber(message.name);
      fieldNumberManager.assignFieldNumber(message.name, protoFieldName, fieldNumber);
    } else {
      // No field number manager, use sequential numbering
      fieldNumber = message.fieldsArray.length + 1;
    }

    const protoField = new protobuf.Field(protoFieldName, fieldNumber, finalTypeName);

    if (isRepeated) {
      protoField.repeated = true;
    }

    if (options?.includeComments && fieldDef.description) {
      protoField.comment = fieldDef.description;
    }

    message.add(protoField);
  }
}

/**
 * Apply selections from an inline fragment to the given protobuf message using the fragment's resolved GraphQL type.
 *
 * Resolves the fragment's type condition via the provided schema when present, falls back to the parent type when absent,
 * and delegates each selection to the appropriate processor (field, nested inline fragment, or fragment spread).
 *
 * @param fragment - Inline fragment AST node whose selections will be applied
 * @param message - Protobuf message to which fields/nested messages will be added
 * @param parentType - GraphQL type context used when the fragment has no type condition
 * @param typeInfo - GraphQL TypeInfo for resolving field/type details during processing
 * @param options - Message builder configuration and helpers
 * @param fieldNumberManager - Optional manager for allocating or reconciling field numbers
 */
function processInlineFragment(
  fragment: InlineFragmentNode,
  message: protobuf.Type,
  parentType: GraphQLObjectType | GraphQLInterfaceType | GraphQLUnionType,
  typeInfo: TypeInfo,
  options?: MessageBuilderOptions,
  fieldNumberManager?: FieldNumberManager,
): void {
  // Determine the type for this inline fragment
  let fragmentType: GraphQLObjectType | GraphQLInterfaceType | GraphQLUnionType;

  if (fragment.typeCondition) {
    // Type condition specified: ... on User
    const typeName = fragment.typeCondition.name.value;
    const schema = options?.schema;

    if (!schema) {
      // Without schema, we can't resolve the type - skip
      return;
    }

    const type = schema.getType(typeName);
    if (!type || !(isObjectType(type) || isInterfaceType(type) || isUnionType(type))) {
      // Type not found or not a supported type - skip
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
        processFieldSelection(selection, message, fragmentType, typeInfo, options, fieldNumberManager);
      } else if (selection.kind === 'InlineFragment') {
        // Nested inline fragment
        processInlineFragment(selection, message, fragmentType, typeInfo, options, fieldNumberManager);
      } else if (selection.kind === 'FragmentSpread') {
        processFragmentSpread(selection, message, fragmentType, typeInfo, options, fieldNumberManager);
      }
    }
  }
}

/**
 * Inlines the selections from a named fragment into the given protobuf message using the fragment's type condition.
 *
 * Looks up the fragment definition by name from `options.fragments`, resolves the fragment's type condition against
 * `options.schema`, and applies each selection to `message`. If the fragment definition, schema, or resolved type
 * cannot be found or is not an object type, the function is a no-op.
 *
 * @param spread - The fragment spread AST node to process
 * @param message - The protobuf message to which selections will be added
 * @param parentType - The GraphQL type in whose context the spread appears
 * @param typeInfo - GraphQL TypeInfo used while processing selections
 * @param options - Message builder options (may contain fragments, schema, and other builders settings)
 * @param fieldNumberManager - Optional manager for assigning or reconciling field numbers
 */
function processFragmentSpread(
  spread: FragmentSpreadNode,
  message: protobuf.Type,
  parentType: GraphQLObjectType | GraphQLInterfaceType | GraphQLUnionType,
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
      processFieldSelection(selection, message, type, typeInfo, options, fieldNumberManager);
    } else if (selection.kind === 'InlineFragment') {
      processInlineFragment(selection, message, type, typeInfo, options, fieldNumberManager);
    } else if (selection.kind === 'FragmentSpread') {
      // Nested fragment spread (fragment inside fragment)
      processFragmentSpread(selection, message, type, typeInfo, options, fieldNumberManager);
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
  const typeInfo = mapGraphQLTypeToProto(fieldType, {
    customScalarMappings: options?.customScalarMappings,
  });

  const field = new protobuf.Field(protoFieldName, fieldNumber, typeInfo.typeName);

  if (typeInfo.isRepeated) {
    field.repeated = true;
  }

  return field;
}

/**
 * Construct a protobuf message type from a map of GraphQL fields.
 *
 * Uses the map's insertion order to add fields. If a FieldNumberManager is provided
 * in `options`, it will be used to obtain and assign field numbers for each field;
 * otherwise fields are numbered sequentially starting at 1.
 *
 * @param messageName - The name to assign to the created protobuf message
 * @param fields - Map of GraphQL field names to their GraphQL types; insertion order determines field order
 * @param options - Optional configuration (e.g., `fieldNumberManager`, custom scalar mappings)
 * @returns The constructed protobuf.Type representing the nested message with its fields added
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
