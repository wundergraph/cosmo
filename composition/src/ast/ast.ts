import {
  BooleanValueNode,
  ConstValueNode,
  DirectiveDefinitionNode,
  EnumTypeDefinitionNode,
  EnumValueDefinitionNode,
  EnumValueNode,
  FieldDefinitionNode,
  FloatValueNode,
  InputObjectTypeDefinitionNode,
  InputValueDefinitionNode,
  InterfaceTypeDefinitionNode,
  IntValueNode,
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
import { federationUnexpectedNodeKindError } from '../errors/errors';
import { InterfaceTypeExtensionNode } from 'graphql/index';

function deepCopyFieldsAndInterfaces(
  node: InterfaceTypeDefinitionNode | ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
  fields: MutableFieldDefinitionNode[], interfaces: NamedTypeNode[],
) {
  if (node.fields) {
    for (const field of node.fields) {
      fields.push(fieldDefinitionNodeToMutable(field, node.name.value)); // TODO better error for arguments
    }
  }
  if (node.interfaces) {
    for (const face of node.interfaces) {
      interfaces.push({ ...face });
    }
  }
}

export type ConstValueNodeWithValue = IntValueNode | FloatValueNode | StringValueNode | BooleanValueNode | EnumValueNode;

export function deepCopyTypeNode(node: TypeNode, parentName: string, fieldName: string): TypeNode {
  const deepCopy: MutableTypeNode = { kind: node.kind };
  let lastTypeNode = deepCopy;
  for (let i = 0; i < maximumTypeNesting; i++) {
    switch (node.kind) {
      case Kind.NAMED_TYPE:
        lastTypeNode.name = { ... node.name };
        return deepCopy as TypeNode;
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
        throw federationUnexpectedNodeKindError(parentName, fieldName);
    }
  }
  throw new Error(`Field ${parentName}.${fieldName} has more than 30 layers of nesting, or there is a cyclical error.`);
}

export type MutableEnumTypeDefinitionNode = {
  description?: StringValueNode,
  kind: Kind.ENUM_TYPE_DEFINITION,
  name: NameNode,
  values: MutableEnumValueDefinitionNode[],
};

export function enumTypeDefinitionNodeToMutable(node: EnumTypeDefinitionNode): MutableEnumTypeDefinitionNode {
  const values: EnumValueDefinitionNode[] = [];
  if (node.values) {
    for (const value of node.values) {
      values.push(enumValueDefinitionNodeToMutable(value));
    }
  }
  return {
    description: node.description ? { ...node.description } : undefined,
    kind: node.kind,
    name: { ...node.name },
    values,
  };
}

export type MutableEnumValueDefinitionNode = {
  description?: StringValueNode;
  kind: Kind.ENUM_VALUE_DEFINITION;
  name: NameNode;
};

export function enumValueDefinitionNodeToMutable(node: EnumValueDefinitionNode): MutableEnumValueDefinitionNode {
  return {
    description: node.description ? { ...node.description } : undefined,
    kind: node.kind,
    name: { ...node.name },
  }
}

export type MutableFieldDefinitionNode = {
  arguments: MutableInputValueDefinitionNode[],
  description?: StringValueNode,
  kind: Kind.FIELD_DEFINITION,
  name: NameNode,
  type: TypeNode,
};

export function fieldDefinitionNodeToMutable(node: FieldDefinitionNode, parentName: string): MutableFieldDefinitionNode {
  const args: MutableInputValueDefinitionNode[] = [];
  if (node.arguments) {
    for (const argument of node.arguments) {
      args.push(inputValueDefinitionNodeToMutable(argument, node.name.value)); // TODO better error for arguments
    }
  }
  return {
    arguments: args,
    description: node.description ? { ...node.description } : undefined,
    kind: node.kind,
    name: { ...node.name },
    type: deepCopyTypeNode(node.type, parentName, node.name.value),
  };
}

export type MutableInputObjectTypeDefinitionNode = {
  description?: StringValueNode,
  fields: InputValueDefinitionNode[];
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION;
  name: NameNode;
};

export function inputObjectTypeDefinitionNodeToMutable(node: InputObjectTypeDefinitionNode): MutableInputObjectTypeDefinitionNode {
  const fields: MutableInputValueDefinitionNode[] = [];
  if (node.fields) {
    for (const field of node.fields) {
      fields.push(inputValueDefinitionNodeToMutable(field, node.name.value));
    }
  }
  return {
    description: node.description ? { ...node.description } : undefined,
    fields,
    kind: node.kind,
    name: { ...node.name },
  };
}

export type MutableInputValueDefinitionNode = {
  defaultValue?: ConstValueNode;
  description?: StringValueNode,
  kind: Kind.INPUT_VALUE_DEFINITION,
  name: NameNode,
  type: TypeNode,
}

export function inputValueDefinitionNodeToMutable(node: InputValueDefinitionNode, parentName: string): MutableInputValueDefinitionNode {
  return {
    defaultValue: node.defaultValue ? { ...node.defaultValue } : undefined,
    description: node.description ? { ...node.description } : undefined,
    kind: node.kind,
    name: { ...node.name },
    type: deepCopyTypeNode(node.type, parentName, node.name.value),
  };
}

export type MutableInterfaceTypeDefinitionNode = {
  description?: StringValueNode,
  fields: FieldDefinitionNode[];
  interfaces: NamedTypeNode[];
  kind: Kind.INTERFACE_TYPE_DEFINITION,
  name: NameNode,
}

export function interfaceTypeDefinitionNodeToMutable(node: InterfaceTypeDefinitionNode): MutableInterfaceTypeDefinitionNode {
  const fields: MutableFieldDefinitionNode[] = [];
  const interfaces: NamedTypeNode[] = [];
  deepCopyFieldsAndInterfaces(node, fields, interfaces);
  return {
    description: node.description ? { ...node.description } : undefined,
    fields,
    interfaces,
    kind: node.kind,
    name: { ...node.name },
  };
}

export type MutableObjectTypeDefinitionNode = {
  description?: StringValueNode,
  fields: FieldDefinitionNode[];
  interfaces: NamedTypeNode[];
  kind: Kind.OBJECT_TYPE_DEFINITION;
  name: NameNode;
};

export function objectTypeDefinitionNodeToMutable(node: ObjectTypeDefinitionNode): MutableObjectTypeDefinitionNode {
  const fields: MutableFieldDefinitionNode[] = [];
  const interfaces: NamedTypeNode[] = [];
  deepCopyFieldsAndInterfaces(node, fields, interfaces);
  return {
    description: node.description ? { ...node.description } : undefined,
    fields,
    interfaces,
    kind: node.kind,
    name: { ...node.name },
  };
}

export type MutableObjectTypeExtensionNode = {
  description?: StringValueNode,
  fields: FieldDefinitionNode[];
  interfaces: NamedTypeNode[];
  kind: Kind.OBJECT_TYPE_EXTENSION;
  name: NameNode;
};

export function objectTypeExtensionNodeToMutable(node: ObjectTypeExtensionNode): MutableObjectTypeExtensionNode {
  const fields: MutableFieldDefinitionNode[] = [];
  const interfaces: NamedTypeNode[] = [];
  deepCopyFieldsAndInterfaces(node, fields, interfaces);
  return {
    fields,
    interfaces,
    kind: node.kind,
    name: { ...node.name },
  };
}

export function objectTypeExtensionNodeToMutableDefinitionNode(node: ObjectTypeExtensionNode): MutableObjectTypeDefinitionNode {
  const fields: MutableFieldDefinitionNode[] = [];
  const interfaces: NamedTypeNode[] = [];
  deepCopyFieldsAndInterfaces(node, fields, interfaces);
  return {
    fields,
    interfaces,
    kind: Kind.OBJECT_TYPE_DEFINITION,
    name: { ...node.name },
  }
}

export type MutableScalarTypeDefinitionNode = {
  description?: StringValueNode;
  kind: Kind.SCALAR_TYPE_DEFINITION;
  name: NameNode;
};

export function scalarTypeDefinitionNodeToMutable(node: ScalarTypeDefinitionNode): MutableScalarTypeDefinitionNode {
  return {
    description: node.description ? { ...node.description } : undefined,
    kind: Kind.SCALAR_TYPE_DEFINITION,
    name: { ...node.name },
  };
}

export type MutableTypeNode = {
  kind: Kind.NAMED_TYPE | Kind.LIST_TYPE | Kind.NON_NULL_TYPE;
  name?: NameNode;
  type?: MutableTypeNode;
}

export const maximumTypeNesting = 30;

export type MutableUnionTypeDefinitionNode = {
  description?: StringValueNode,
  kind: Kind.UNION_TYPE_DEFINITION;
  name: NameNode;
  types: NamedTypeNode[];
};

export function unionTypeDefinitionNodeToMutable(node: UnionTypeDefinitionNode): MutableUnionTypeDefinitionNode {
  const types: NamedTypeNode[] = [];
  if (node.types) {
    for (const member of node.types) {
      types.push({ ...member });
    }
  }
  return {
    description: node.description ? { ...node.description } : undefined,
    kind: node.kind,
    name: { ...node.name },
    types,
  };
}

export type MutableTypeDefinitionNode =
  | MutableScalarTypeDefinitionNode
  | MutableObjectTypeDefinitionNode
  | MutableInterfaceTypeDefinitionNode
  | MutableUnionTypeDefinitionNode
  | MutableEnumTypeDefinitionNode
  | MutableInputObjectTypeDefinitionNode
  | DirectiveDefinitionNode;

export type ObjectLikeTypeDefinitionNode =
  InterfaceTypeDefinitionNode
  | InterfaceTypeExtensionNode
  | ObjectTypeDefinitionNode
  | ObjectTypeExtensionNode;