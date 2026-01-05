import {
  GraphQLType,
  isListType,
  isNonNullType,
  isScalarType,
  isEnumType,
  GraphQLNamedType,
  getNamedType,
  GraphQLList,
  GraphQLNonNull,
} from 'graphql';
import {
  CompositeMessageDefinition,
  isUnionMessageDefinition,
  ProtoFieldType,
  ProtoMessage,
  RPCMethod,
  SCALAR_TYPE_MAP,
  SCALAR_WRAPPER_TYPE_MAP,
} from './types';
import { unwrapNonNullType, isNestedListType, calculateNestingLevel } from './operations/list-type-utils';
import { graphqlFieldToProtoField } from './naming-conventions';

const SPACE_INDENT = '  '; // 2 spaces
const LINE_COMMENT_PREFIX = '// ';
const BLOCK_COMMENT_START = '/*';
const BLOCK_COMMENT_END = '*/';

/**
 * Builds a message definition from a ProtoMessage object
 * @param message - The ProtoMessage object
 * @returns The message definition
 */
export function buildProtoMessage(includeComments: boolean, message: ProtoMessage): string[] {
  return buildProtoMessageWithIndent(includeComments, message, 0);
}

/**
 * Builds a message definition from a ProtoMessage object with an indent level
 * @param includeComments - Whether to include comments
 * @param message - The ProtoMessage object
 * @param indent - The indent level
 * @returns The message lines
 */
function buildProtoMessageWithIndent(includeComments: boolean, message: ProtoMessage, indent: number): string[] {
  const messageLines = formatComment(includeComments, message.description, indent);
  messageLines.push(indentContent(indent, `message ${message.messageName} {`));

  // if we have nested messages, we need to build them first
  if (message.nestedMessages && message.nestedMessages.length > 0) {
    message.nestedMessages.forEach((nestedMessage) => {
      messageLines.push(...buildProtoMessageWithIndent(includeComments, nestedMessage, indent + 1));
    });
  }

  if (message.compositeType) {
    messageLines.push(...buildCompositeTypeMessage(includeComments, message.compositeType, indent + 1));
  }

  if (message.reservedNumbers && message.reservedNumbers.length > 0) {
    messageLines.push(indentContent(indent + 1, `reserved ${message.reservedNumbers};`));
  }

  message.fields.forEach((field) => {
    if (field.description) {
      messageLines.push(...formatComment(includeComments, field.description, indent + 1));
    }

    let repeated = field.isRepeated ? 'repeated ' : '';

    messageLines.push(
      indentContent(indent + 1, `${repeated}${field.typeName} ${field.fieldName} = ${field.fieldNumber};`),
    );
  });
  messageLines.push(indentContent(indent, '}'), '');
  return messageLines;
}

/**
 * Builds a composite type message
 * @param includeComments - Whether to include comments
 * @param compositeType - The composite type definition
 * @param indent - The indent level
 * @returns The message lines
 * @example
 * ```proto
 * // A union type uses `value`
 * message Animal {
 *   oneof value {
 *     Cat cat = 1;
 *     Dog dog = 2;
 *   }
 * }
 *
 * // An interface type uses `instance`
 * message Animal {
 *   oneof instance {
 *     Cat cat = 1;
 *     Dog dog = 2;
 *   }
 * }
 * ```
 */
function buildCompositeTypeMessage(
  includeComments: boolean,
  compositeType: CompositeMessageDefinition,
  indent: number,
): string[] {
  const lines: string[] = [];

  if (includeComments && compositeType.description) {
    lines.push(...formatComment(includeComments, compositeType.description, indent));
  }

  let oneOfName = '';
  let compositeTypes: string[] = [];

  if (isUnionMessageDefinition(compositeType)) {
    oneOfName = 'value';
    compositeTypes = compositeType.memberTypes;
  } else {
    oneOfName = 'instance';
    compositeTypes = compositeType.implementingTypes;
  }

  lines.push(
    indentContent(indent, `message ${compositeType.typeName} {`),
    indentContent(indent + 1, `oneof ${oneOfName} {`),
  );

  compositeTypes.forEach((compositeType, index) => {
    lines.push(
      indentContent(indent + 2, `${compositeType} ${graphqlFieldToProtoField(compositeType)} = ${index + 1};`),
    );
  });

  lines.push(indentContent(indent + 1, '}'));
  lines.push(indentContent(indent, '}'));

  return lines;
}

/**
 * Convert a GraphQL description to Protocol Buffer comment
 * @param description - The GraphQL description text
 * @param indentLevel - The level of indentation for the comment (in number of 2-space blocks)
 * @returns Array of comment lines with proper indentation
 */
export function formatComment(
  includeComments: boolean,
  description: string | undefined | null,
  indentLevel: number = 0,
): string[] {
  if (!includeComments || !description) {
    return [];
  }

  // Use 2-space indentation consistently
  const indent = SPACE_INDENT.repeat(indentLevel);
  const lines = description.trim().split('\n');

  if (lines.length === 1) {
    return [`${indent}${LINE_COMMENT_PREFIX}${lines[0]}`];
  } else {
    return [
      `${indent}${BLOCK_COMMENT_START}`,
      ...lines.map((line) => `${indent} * ${line}`),
      `${indent} ${BLOCK_COMMENT_END}`,
    ];
  }
}

export function renderRPCMethod(includeComments: boolean, rpcMethod: RPCMethod): string[] {
  const lines: string[] = [];

  if (includeComments && rpcMethod.description) {
    lines.push(...formatComment(includeComments, rpcMethod.description, 1));
  }

  lines.push(indentContent(1, `rpc ${rpcMethod.name}(${rpcMethod.request}) returns (${rpcMethod.response}) {}`));
  return lines;
}

/**
 * Map GraphQL type to Protocol Buffer type
 *
 * Determines the appropriate Protocol Buffer type for a given GraphQL type,
 * including the use of wrapper types for nullable scalar fields to distinguish
 * between unset fields and zero values.
 *
 * @param graphqlType - The GraphQL type to convert
 * @param ignoreWrapperTypes - If true, do not use wrapper types for nullable scalar fields
 * @returns The corresponding Protocol Buffer type name
 */
export function getProtoTypeFromGraphQL(
  includeComments: boolean,
  graphqlType: GraphQLType,
  ignoreWrapperTypes: boolean = false,
): ProtoFieldType {
  // Nullable lists need to be handled first, otherwise they will be treated as scalar types
  if (isListType(graphqlType) || (isNonNullType(graphqlType) && isListType(graphqlType.ofType))) {
    return handleListType(includeComments, graphqlType);
  }
  // For nullable scalar types, use wrapper types
  if (isScalarType(graphqlType)) {
    if (ignoreWrapperTypes) {
      return { typeName: SCALAR_TYPE_MAP[graphqlType.name] || 'string', isRepeated: false, isWrapper: false };
    }
    return {
      typeName: SCALAR_WRAPPER_TYPE_MAP[graphqlType.name] || 'google.protobuf.StringValue',
      isRepeated: false,
      isWrapper: true,
    };
  }

  if (isEnumType(graphqlType)) {
    return { typeName: graphqlType.name, isRepeated: false, isWrapper: false };
  }

  if (isNonNullType(graphqlType)) {
    // For non-null scalar types, use the base type
    if (isScalarType(graphqlType.ofType)) {
      return { typeName: SCALAR_TYPE_MAP[graphqlType.ofType.name] || 'string', isRepeated: false, isWrapper: false };
    }

    return getProtoTypeFromGraphQL(includeComments, graphqlType.ofType);
  }
  // Named types (object, interface, union, input)
  const namedType = graphqlType as GraphQLNamedType;
  if (namedType && typeof namedType.name === 'string') {
    return { typeName: namedType.name, isRepeated: false, isWrapper: false };
  }

  return { typeName: 'string', isRepeated: false, isWrapper: false }; // Default fallback
}

/**
 * Converts GraphQL list types to appropriate Protocol Buffer representations.
 *
 * For non-nullable, single-level lists (e.g., [String!]!), generates simple repeated fields.
 * For nullable lists (e.g., [String]) or nested lists (e.g., [[String]]), creates wrapper
 * messages to properly handle nullability in proto3.
 *
 * Examples:
 * - [String!]! → repeated string field_name = 1;
 * - [String] → ListOfString field_name = 1; (with wrapper message)
 * - [[String!]!]! → ListOfListOfString field_name = 1; (with nested wrapper messages)
 * - [[String]] → ListOfListOfString field_name = 1; (with nested wrapper messages)
 *
 * @param graphqlType - The GraphQL list type to convert
 * @returns ProtoType object containing the type name and whether it should be repeated
 */
export function handleListType(
  includeComments: boolean,
  graphqlType: GraphQLList<GraphQLType> | GraphQLNonNull<GraphQLList<GraphQLType>>,
): ProtoFieldType {
  const listType = unwrapNonNullType(graphqlType);
  const isNullableList = !isNonNullType(graphqlType);
  const isNested = isNestedListType(listType);

  // Simple non-nullable lists can use repeated fields directly
  if (!isNullableList && !isNested) {
    return { ...getProtoTypeFromGraphQL(includeComments, getNamedType(listType), true), isRepeated: true };
  }

  // Nullable or nested lists need wrapper messages
  const baseType = getNamedType(listType);
  const nestingLevel = calculateNestingLevel(listType);

  // For nested lists, always use full nesting level to preserve inner list nullability
  // For single-level nullable lists, use nesting level 1
  const wrapperNestingLevel = isNested ? nestingLevel : 1;

  // Generate all required wrapper messages
  let wrapperName = listNameByNestingLevel(wrapperNestingLevel, baseType);

  // For nested lists, never use repeated at field level to preserve nullability
  return {
    typeName: wrapperName,
    isWrapper: false,
    isRepeated: false,
    listWrapper: { baseType, nestingLevel: wrapperNestingLevel },
  };
}

export function listNameByNestingLevel(nestingLevel: number, baseType: GraphQLNamedType): string {
  return `${'ListOf'.repeat(nestingLevel)}${baseType.name}`;
}
/**
 * Creates wrapper messages for nullable or nested GraphQL lists.
 *
 * Generates Protocol Buffer message definitions to handle list nullability and nesting.
 * The wrapper messages are stored and later included in the final proto output.
 *
 * For level 1: Creates simple wrapper like:
 *   message ListOfString {
 *     repeated string items = 1;
 *   }
 *
 * For level > 1: Creates nested wrapper structures like:
 *   message ListOfListOfString {
 *     message List {
 *       repeated ListOfString items = 1;
 *     }
 *     List list = 1;
 *   }
 *
 * @param level - The nesting level (1 for simple wrapper, >1 for nested structures)
 * @param baseType - The GraphQL base type being wrapped (e.g., String, User, etc.)
 * @returns The generated wrapper message name (e.g., "ListOfString", "ListOfListOfUser")
 */
export function createNestedListWrapper(includeComments: boolean, level: number, baseType: GraphQLNamedType): string {
  const wrapperName = `${'ListOf'.repeat(level)}${baseType.name}`;
  return buildWrapperMessage(includeComments, wrapperName, level, baseType).join('\n');
}

/**
 * Builds the message lines for a wrapper message
 */
function buildWrapperMessage(
  includeComments: boolean,
  wrapperName: string,
  level: number,
  baseType: GraphQLNamedType,
): string[] {
  const lines: string[] = [];

  // Add comment if enabled
  if (includeComments) {
    lines.push(...formatComment(includeComments, `Wrapper message for a list of ${baseType.name}.`, 0));
  }

  const formatIndent = (indent: number, content: string) => {
    return '  '.repeat(indent) + content;
  };

  lines.push(`message ${wrapperName} {`);
  let innerWrapperName = '';
  if (level > 1) {
    innerWrapperName = `${'ListOf'.repeat(level - 1)}${baseType.name}`;
  } else {
    innerWrapperName = getProtoTypeFromGraphQL(includeComments, baseType, true).typeName;
  }

  lines.push(
    formatIndent(1, `message List {`),
    formatIndent(2, `repeated ${innerWrapperName} items = 1;`),
    formatIndent(1, `}`),
    formatIndent(1, `List list = 1;`),
    formatIndent(0, `}`),
  );

  return lines;
}

/**
 * Indents the content by the given indent level
 * @param indentLevel - The indent level
 * @param content - The content to indent
 * @returns The indented content
 */
const indentContent = (indentLevel: number, content: string): string => SPACE_INDENT.repeat(indentLevel) + content;
