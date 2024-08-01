import {
  ArgumentNode,
  DocumentNode,
  EnumTypeDefinitionNode,
  EnumTypeExtensionNode,
  FieldNode,
  InputObjectTypeDefinitionNode,
  InputObjectTypeExtensionNode,
  InterfaceTypeDefinitionNode,
  InterfaceTypeExtensionNode,
  Kind,
  NamedTypeNode,
  NameNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  OperationTypeNode,
  parse,
  ScalarTypeDefinitionNode,
  ScalarTypeExtensionNode,
  SchemaDefinitionNode,
  SchemaExtensionNode,
  SelectionSetNode,
  StringValueNode,
  UnionTypeDefinitionNode,
  UnionTypeExtensionNode,
} from 'graphql';
import {
  ARGUMENT_DEFINITION_UPPER,
  ENUM_UPPER,
  ENUM_VALUE_UPPER,
  EXECUTABLE_DIRECTIVE_LOCATIONS,
  EXTENDS,
  FIELD_DEFINITION_UPPER,
  FRAGMENT_DEFINITION_UPPER,
  FRAGMENT_SPREAD_UPPER,
  INLINE_FRAGMENT_UPPER,
  INPUT_FIELD_DEFINITION_UPPER,
  INPUT_OBJECT_UPPER,
  INTERFACE_OBJECT,
  INTERFACE_UPPER,
  KEY,
  MUTATION,
  OBJECT_UPPER,
  QUERY,
  SCALAR_UPPER,
  SCHEMA_UPPER,
  SUBSCRIPTION,
  UNION_UPPER,
} from '../utils/string-constants';
import { duplicateInterfaceError, unexpectedKindFatalError } from '../errors/errors';
import { ObjectLikeTypeNode } from '../schema-building/ast';

export function isObjectLikeNodeEntity(node: ObjectLikeTypeNode): boolean {
  if (!node.directives?.length) {
    return false;
  }
  for (const directive of node.directives) {
    if (directive.name.value === KEY) {
      return true;
    }
  }
  return false;
}
export function isNodeInterfaceObject(node: ObjectTypeDefinitionNode): boolean {
  if (!node.directives?.length) {
    return false;
  }
  for (const directive of node.directives) {
    if (directive.name.value === INTERFACE_OBJECT) {
      return true;
    }
  }
  return false;
}

export function isNodeExtension(node: ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode): boolean {
  if (!node.directives?.length) {
    return false;
  }
  for (const directive of node.directives) {
    if (directive.name.value === EXTENDS) {
      return true;
    }
  }
  return false;
}

export function extractInterfaces(
  node: InterfaceTypeDefinitionNode | InterfaceTypeExtensionNode | ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
  interfaces: Set<string>,
  errors?: Error[],
): Set<string> {
  if (!node.interfaces) {
    return interfaces;
  }
  const parentTypeName = node.name.value;
  for (const face of node.interfaces) {
    const name = face.name.value;
    if (errors && interfaces.has(name)) {
      errors.push(duplicateInterfaceError(name, parentTypeName));
      continue;
    }
    interfaces.add(name);
  }
  return interfaces;
}

export function areBaseAndExtensionKindsCompatible(baseKind: Kind, extensionKind: Kind, typeName: string): boolean {
  switch (baseKind) {
    case Kind.ENUM_TYPE_DEFINITION:
      return extensionKind === Kind.ENUM_TYPE_EXTENSION;
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
      return extensionKind === Kind.INPUT_OBJECT_TYPE_EXTENSION;
    case Kind.INTERFACE_TYPE_DEFINITION:
      return extensionKind === Kind.INTERFACE_TYPE_EXTENSION;
    case Kind.OBJECT_TYPE_DEFINITION:
      return extensionKind === Kind.OBJECT_TYPE_EXTENSION;
    case Kind.SCALAR_TYPE_DEFINITION:
      return extensionKind === Kind.SCALAR_TYPE_EXTENSION;
    case Kind.UNION_TYPE_DEFINITION:
      return extensionKind === Kind.UNION_TYPE_EXTENSION;
    default:
      return false;
  }
}

export function stringToNameNode(value: string): NameNode {
  return {
    kind: Kind.NAME,
    value,
  };
}

export function stringArrayToNameNodeArray(values: string[]): NameNode[] {
  const nameNodes: NameNode[] = [];
  for (const value of values) {
    nameNodes.push(stringToNameNode(value));
  }
  return nameNodes;
}

export function setToNameNodeArray(set: Set<string>): NameNode[] {
  const nameNodes: NameNode[] = [];
  for (const value of set) {
    nameNodes.push(stringToNameNode(value));
  }
  return nameNodes;
}

export function stringToNamedTypeNode(value: string): NamedTypeNode {
  return {
    kind: Kind.NAMED_TYPE,
    name: stringToNameNode(value),
  };
}

export function setToNamedTypeNodeArray(set: Set<string>): NamedTypeNode[] {
  const namedTypeNodes: NamedTypeNode[] = [];
  for (const entry of set) {
    namedTypeNodes.push(stringToNamedTypeNode(entry));
  }
  return namedTypeNodes;
}

export function nodeKindToDirectiveLocation(kind: Kind): string {
  switch (kind) {
    case Kind.ARGUMENT:
      return ARGUMENT_DEFINITION_UPPER;
    case Kind.ENUM_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.ENUM_TYPE_EXTENSION:
      return ENUM_UPPER;
    case Kind.ENUM_VALUE_DEFINITION:
      return ENUM_VALUE_UPPER;
    case Kind.FIELD_DEFINITION:
      return FIELD_DEFINITION_UPPER;
    case Kind.FRAGMENT_DEFINITION:
      return FRAGMENT_DEFINITION_UPPER;
    case Kind.FRAGMENT_SPREAD:
      return FRAGMENT_SPREAD_UPPER;
    case Kind.INLINE_FRAGMENT:
      return INLINE_FRAGMENT_UPPER;
    case Kind.INPUT_VALUE_DEFINITION:
      return INPUT_FIELD_DEFINITION_UPPER;
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.INPUT_OBJECT_TYPE_EXTENSION:
      return INPUT_OBJECT_UPPER;
    case Kind.INTERFACE_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.INTERFACE_TYPE_EXTENSION:
      return INTERFACE_UPPER;
    case Kind.OBJECT_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.OBJECT_TYPE_EXTENSION:
      return OBJECT_UPPER;
    case Kind.SCALAR_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.SCALAR_TYPE_EXTENSION:
      return SCALAR_UPPER;
    case Kind.SCHEMA_DEFINITION:
    // intentional fallthrough
    case Kind.SCHEMA_EXTENSION:
      return SCHEMA_UPPER;
    case Kind.UNION_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.UNION_TYPE_EXTENSION:
      return UNION_UPPER;
    default:
      return kind;
  }
}

export const operationTypeNodeToDefaultType = new Map<OperationTypeNode, string>([
  [OperationTypeNode.MUTATION, MUTATION],
  [OperationTypeNode.QUERY, QUERY],
  [OperationTypeNode.SUBSCRIPTION, SUBSCRIPTION],
]);

export function isKindAbstract(kind: Kind) {
  return kind === Kind.INTERFACE_TYPE_DEFINITION || kind === Kind.UNION_TYPE_DEFINITION;
}

export function extractExecutableDirectiveLocations(
  nodes: readonly NameNode[] | NameNode[],
  set: Set<string>,
): Set<string> {
  for (const node of nodes) {
    const name = node.value;
    if (EXECUTABLE_DIRECTIVE_LOCATIONS.has(name)) {
      set.add(name);
    }
  }
  return set;
}

export function formatDescription(description?: StringValueNode): StringValueNode | undefined {
  if (!description) {
    return description;
  }
  let value = description.value;
  if (description.block) {
    const lines = value.split('\n');
    if (lines.length > 1) {
      value = lines.map((line) => line.trimStart()).join('\n');
    }
  }
  return { ...description, value: value, block: true };
}

export function lexicographicallySortArgumentNodes(fieldNode: FieldNode): ArgumentNode[] | undefined {
  if (!fieldNode.arguments) {
    return fieldNode.arguments;
  }
  const argumentNodes = fieldNode.arguments as ArgumentNode[];
  return argumentNodes.sort((a, b) => a.name.value.localeCompare(b.name.value));
}

export function lexicographicallySortSelectionSetNode(selectionSetNode: SelectionSetNode): SelectionSetNode {
  const selections = selectionSetNode.selections as FieldNode[];
  return {
    ...selectionSetNode,
    selections: selections
      .sort((a, b) => a.name.value.localeCompare(b.name.value))
      .map((selection) => ({
        ...selection,
        arguments: lexicographicallySortArgumentNodes(selection),
        selectionSet: selection.selectionSet
          ? lexicographicallySortSelectionSetNode(selection.selectionSet)
          : selection.selectionSet,
      })),
  };
}

export function lexicographicallySortDocumentNode(documentNode: DocumentNode): DocumentNode {
  return {
    ...documentNode,
    definitions: documentNode.definitions.map((definition) => {
      if (definition.kind !== Kind.OPERATION_DEFINITION) {
        return definition;
      }
      return {
        ...definition,
        selectionSet: lexicographicallySortSelectionSetNode(definition.selectionSet),
      };
    }),
  };
}

type ParseResult = {
  documentNode?: DocumentNode;
  error?: Error;
};

export function safeParse(value: string): ParseResult {
  try {
    const parsedValue = parse(value, { noLocation: true });
    return { documentNode: parsedValue };
  } catch (e) {
    return { error: e as Error };
  }
}

export type EnumTypeNode = EnumTypeDefinitionNode | EnumTypeExtensionNode;
export type InputObjectTypeNode = InputObjectTypeDefinitionNode | InputObjectTypeExtensionNode;
export type InterfaceTypeNode = InterfaceTypeDefinitionNode | InterfaceTypeExtensionNode;
export type ObjectTypeNode = ObjectTypeDefinitionNode | ObjectTypeExtensionNode;
export type ScalarTypeNode = ScalarTypeDefinitionNode | ScalarTypeExtensionNode;
export type SchemaNode = SchemaDefinitionNode | SchemaExtensionNode;
export type UnionTypeNode = UnionTypeDefinitionNode | UnionTypeExtensionNode;
