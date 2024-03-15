import {
  ConstDirectiveNode,
  ConstValueNode,
  DirectiveDefinitionNode,
  EnumTypeDefinitionNode,
  EnumValueDefinitionNode,
  FieldDefinitionNode,
  InputObjectTypeDefinitionNode,
  InputValueDefinitionNode,
  InterfaceTypeDefinitionNode,
  InterfaceTypeExtensionNode,
  Kind,
  NamedTypeNode,
  NameNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  ScalarTypeDefinitionNode,
  StringValueNode,
  TypeNode,
  UnionTypeDefinitionNode,
} from 'graphql';
import { formatDescription, stringToNameNode } from '../ast/utils';
import { maximumTypeNestingExceededError, unexpectedTypeNodeKindFatalError } from '../errors/errors';
import { MAXIMUM_TYPE_NESTING } from '../utils/constants';

export type MutableDirectiveDefinitionNode = {
  arguments: MutableInputValueNode[];
  kind: Kind.DIRECTIVE_DEFINITION;
  locations: NameNode[];
  name: NameNode;
  repeatable: boolean;
  description?: StringValueNode;
};

export function getMutableDirectiveDefinitionNode(node: DirectiveDefinitionNode): MutableDirectiveDefinitionNode {
  return {
    arguments: [],
    kind: node.kind,
    locations: [],
    name: { ...node.name },
    repeatable: node.repeatable,
    description: formatDescription(node.description),
  };
}

export type MutableEnumNode = {
  kind: Kind.ENUM_TYPE_DEFINITION;
  name: NameNode;
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
  values?: MutableEnumValueNode[];
};

export function getMutableEnumNode(node: EnumTypeDefinitionNode): MutableEnumNode {
  return {
    kind: node.kind,
    name: { ...node.name },
    description: formatDescription(node.description),
    values: node.values?.map((value) => getMutableEnumValueNode(value)),
  };
}

export type MutableEnumValueNode = {
  directives: ConstDirectiveNode[]; // always initialise for ease
  kind: Kind.ENUM_VALUE_DEFINITION;
  name: NameNode;
  description?: StringValueNode;
};

export function getMutableEnumValueNode(node: EnumValueDefinitionNode): MutableEnumValueNode {
  return {
    directives: [],
    kind: node.kind,
    name: { ...node.name },
    description: formatDescription(node.description),
  };
}

export type MutableFieldNode = {
  arguments: MutableInputValueNode[]; // always initialise for ease
  directives: ConstDirectiveNode[]; // always initialise for ease
  kind: Kind.FIELD_DEFINITION;
  name: NameNode;
  type: MutableTypeNode;
  description?: StringValueNode;
};

export function getMutableFieldNode(node: FieldDefinitionNode, hostPath: string, errors: Error[]): MutableFieldNode {
  return {
    arguments: [],
    directives: [],
    kind: node.kind,
    name: { ...node.name },
    type: getMutableTypeNode(node.type, hostPath, errors),
    description: formatDescription(node.description),
  };
}

export type MutableInputObjectNode = {
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION;
  name: NameNode;
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
  fields?: InputValueDefinitionNode[];
};

export function getMutableInputObjectNode(node: InputObjectTypeDefinitionNode): MutableInputObjectNode {
  return {
    kind: node.kind,
    name: { ...node.name },
    description: formatDescription(node.description),
  };
}

export type MutableInputValueNode = {
  directives: ConstDirectiveNode[]; // always initialise for ease
  kind: Kind.INPUT_VALUE_DEFINITION;
  name: NameNode;
  type: MutableTypeNode;
  defaultValue?: ConstValueNode;
  description?: StringValueNode;
};

export function getMutableInputValueNode(
  node: InputValueDefinitionNode,
  hostPath: string,
  errors: Error[],
): MutableInputValueNode {
  return {
    directives: [],
    kind: node.kind,
    name: { ...node.name },
    type: getMutableTypeNode(node.type, hostPath, errors),
    defaultValue: node.defaultValue,
    description: formatDescription(node.description),
  };
}

export type MutableInterfaceNode = {
  kind: Kind.INTERFACE_TYPE_DEFINITION;
  name: NameNode;
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
  fields?: FieldDefinitionNode[];
  interfaces?: NamedTypeNode[];
};

export function getMutableInterfaceNode(node: InterfaceTypeDefinitionNode): MutableInterfaceNode {
  return {
    kind: node.kind,
    name: { ...node.name },
    description: formatDescription(node.description),
  };
}

export type MutableObjectNode = {
  kind: Kind.OBJECT_TYPE_DEFINITION;
  name: NameNode;
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
  fields?: FieldDefinitionNode[];
  interfaces?: NamedTypeNode[];
};

export function getMutableObjectNode(node: ObjectTypeDefinitionNode): MutableObjectNode {
  return {
    kind: node.kind,
    name: { ...node.name },
    description: formatDescription(node.description),
  };
}

export type MutableObjectExtensionNode = {
  kind: Kind.OBJECT_TYPE_EXTENSION;
  name: NameNode;
  description?: StringValueNode; // @extends directive would allow for a description
  directives?: ConstDirectiveNode[];
  fields?: FieldDefinitionNode[];
  interfaces?: NamedTypeNode[];
};

export function getMutableObjectExtensionNode(
  node: ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
): MutableObjectExtensionNode {
  const description = node.kind === Kind.OBJECT_TYPE_DEFINITION ? node.description : undefined;
  return {
    kind: Kind.OBJECT_TYPE_EXTENSION,
    name: { ...node.name },
    description: formatDescription(description),
  };
}

export type MutableScalarNode = {
  kind: Kind.SCALAR_TYPE_DEFINITION;
  name: NameNode;
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
};

export function getMutableScalarNode(node: ScalarTypeDefinitionNode): MutableScalarNode {
  return {
    kind: node.kind,
    name: { ...node.name },
    description: formatDescription(node.description),
  };
}

// This type allows the building of a MutableTypeNode
export type MutableIntermediateTypeNode = {
  kind: Kind.NAMED_TYPE | Kind.LIST_TYPE | Kind.NON_NULL_TYPE;
  name?: NameNode;
  type?: MutableIntermediateTypeNode;
};

export type MutableTypeNode = MutableNamedTypeNode | MutableListTypeNode | MutableNonNullTypeNode;

export type MutableNamedTypeNode = {
  kind: Kind.NAMED_TYPE;
  name: NameNode;
};

export type MutableListTypeNode = {
  kind: Kind.LIST_TYPE;
  type: MutableTypeNode;
};

export type MutableNonNullTypeNode = {
  kind: Kind.NON_NULL_TYPE;
  type: MutableNamedTypeNode | MutableListTypeNode;
};

export function getMutableTypeNode(node: TypeNode, typePath: string, errors: Error[]): MutableTypeNode {
  const deepCopy: MutableIntermediateTypeNode = { kind: node.kind };
  let lastTypeNode = deepCopy;
  for (let i = 0; i < MAXIMUM_TYPE_NESTING; i++) {
    switch (node.kind) {
      case Kind.NAMED_TYPE:
        lastTypeNode.name = { ...node.name };
        return deepCopy as MutableTypeNode;
      case Kind.LIST_TYPE:
        lastTypeNode.kind = node.kind;
        lastTypeNode.type = { kind: node.type.kind };
        lastTypeNode = lastTypeNode.type;
        node = node.type;
        continue;
      case Kind.NON_NULL_TYPE:
        lastTypeNode.kind = node.kind;
        lastTypeNode.type = { kind: node.type.kind };
        lastTypeNode = lastTypeNode.type;
        node = node.type;
        continue;
      default:
        throw unexpectedTypeNodeKindFatalError(typePath);
    }
  }
  errors.push(maximumTypeNestingExceededError(typePath, MAXIMUM_TYPE_NESTING));
  // Return a dummy type when the type has exceeded nesting
  return { kind: Kind.NAMED_TYPE, name: stringToNameNode(getTypeNodeNamedTypeName(node)) };
}

export type MutableUnionNode = {
  kind: Kind.UNION_TYPE_DEFINITION;
  name: NameNode;
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
  types?: NamedTypeNode[];
};

export function getMutableUnionNode(node: UnionTypeDefinitionNode): MutableUnionNode {
  return {
    kind: node.kind,
    name: { ...node.name },
    description: formatDescription(node.description),
  };
}

export type MutableTypeDefinitionNode =
  | MutableDirectiveDefinitionNode
  | MutableEnumNode
  | MutableInputObjectNode
  | MutableInterfaceNode
  | MutableObjectNode
  | MutableScalarNode
  | MutableUnionNode;

export type ObjectLikeTypeNode =
  | InterfaceTypeDefinitionNode
  | InterfaceTypeExtensionNode
  | ObjectTypeDefinitionNode
  | ObjectTypeExtensionNode;

export function getTypeNodeNamedTypeName(typeNode: TypeNode): string {
  switch (typeNode.kind) {
    case Kind.NAMED_TYPE:
      return typeNode.name.value;
    case Kind.LIST_TYPE:
    // intentional fallthrough
    case Kind.NON_NULL_TYPE:
      return getTypeNodeNamedTypeName(typeNode.type);
  }
}
