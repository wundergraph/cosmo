import {
  BooleanValueNode,
  ConstDirectiveNode,
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
  InterfaceTypeExtensionNode,
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
import { formatDescription } from './utils';

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

export type MutableDirectiveDefinitionNode = {
  arguments?: InputValueDefinitionNode[];
  description?: StringValueNode;
  kind: Kind.DIRECTIVE_DEFINITION;
  locations: NameNode[];
  name: NameNode;
  repeatable: boolean;
};

export function directiveDefinitionNodeToMutable(node: DirectiveDefinitionNode): MutableDirectiveDefinitionNode {
  return {
    arguments: node.arguments ? [...node.arguments] : undefined,
    description: formatDescription(node.description),
    kind: node.kind,
    locations: [...node.locations],
    name: { ...node.name },
    repeatable: node.repeatable,
  };
}

export type MutableEnumTypeDefinitionNode = {
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
  kind: Kind.ENUM_TYPE_DEFINITION;
  name: NameNode;
  values: MutableEnumValueDefinitionNode[];
};

export function enumTypeDefinitionNodeToMutable(node: EnumTypeDefinitionNode): MutableEnumTypeDefinitionNode {
  const values: MutableEnumValueDefinitionNode[] = [];
  if (node.values) {
    for (const value of node.values) {
      values.push(enumValueDefinitionNodeToMutable(value));
    }
  }
  return {
    description: formatDescription(node.description),
    kind: node.kind,
    name: { ...node.name },
    values,
  };
}

export type MutableEnumValueDefinitionNode = {
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
  kind: Kind.ENUM_VALUE_DEFINITION;
  name: NameNode;
};

export function enumValueDefinitionNodeToMutable(node: EnumValueDefinitionNode): MutableEnumValueDefinitionNode {
  return {
    description: formatDescription(node.description),
    kind: node.kind,
    name: { ...node.name },
  }
}

export type MutableFieldDefinitionNode = {
  arguments: MutableInputValueDefinitionNode[];
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
  kind: Kind.FIELD_DEFINITION;
  name: NameNode;
  type: TypeNode;
};

export function fieldDefinitionNodeToMutable(node: FieldDefinitionNode, parentName: string): MutableFieldDefinitionNode {
  const args: MutableInputValueDefinitionNode[] = [];
  if (node.arguments) {
    for (const argument of node.arguments) {
      args.push(inputValueDefinitionNodeToMutable(argument, node.name.value));
    }
  }
  return {
    arguments: args,
    description: formatDescription(node.description),
    kind: node.kind,
    name: { ...node.name },
    type: deepCopyTypeNode(node.type, parentName, node.name.value),
  };
}

export type MutableInputObjectTypeDefinitionNode = {
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
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
    description: formatDescription(node.description),
    fields,
    kind: node.kind,
    name: { ...node.name },
  };
}

export type MutableInputValueDefinitionNode = {
  defaultValue?: ConstValueNode;
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
  kind: Kind.INPUT_VALUE_DEFINITION;
  name: NameNode;
  type: TypeNode;
}

export function inputValueDefinitionNodeToMutable(node: InputValueDefinitionNode, parentName: string): MutableInputValueDefinitionNode {
  return {
    defaultValue: node.defaultValue ? { ...node.defaultValue } : undefined,
    description: formatDescription(node.description),
    directives: node.directives ? [...node.directives] : undefined,
    kind: node.kind,
    name: { ...node.name },
    type: deepCopyTypeNode(node.type, parentName, node.name.value),
  };
}

export type MutableInterfaceTypeDefinitionNode = {
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
  fields: FieldDefinitionNode[];
  interfaces: NamedTypeNode[];
  kind: Kind.INTERFACE_TYPE_DEFINITION;
  name: NameNode;
}

export function interfaceTypeDefinitionNodeToMutable(node: InterfaceTypeDefinitionNode): MutableInterfaceTypeDefinitionNode {
  const fields: MutableFieldDefinitionNode[] = [];
  const interfaces: NamedTypeNode[] = [];
  deepCopyFieldsAndInterfaces(node, fields, interfaces);
  return {
    description: formatDescription(node.description),
    fields,
    interfaces,
    kind: node.kind,
    name: { ...node.name },
  };
}

export type MutableObjectTypeDefinitionNode = {
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
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
    description: formatDescription(node.description),
    fields,
    interfaces,
    kind: node.kind,
    name: { ...node.name },
  };
}

export type MutableObjectTypeExtensionNode = {
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
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
  directives?: ConstDirectiveNode[];
  kind: Kind.SCALAR_TYPE_DEFINITION;
  name: NameNode;
};

export function scalarTypeDefinitionNodeToMutable(node: ScalarTypeDefinitionNode): MutableScalarTypeDefinitionNode {
  return {
    description: formatDescription(node.description),
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
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
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
    description: formatDescription(node.description),
    kind: node.kind,
    name: { ...node.name },
    types,
  };
}

export type MutableTypeDefinitionNode =
  MutableDirectiveDefinitionNode
  | MutableEnumTypeDefinitionNode
  | MutableInputObjectTypeDefinitionNode
  | MutableInterfaceTypeDefinitionNode
  | MutableObjectTypeDefinitionNode
  | MutableScalarTypeDefinitionNode
  | MutableUnionTypeDefinitionNode;


export type ObjectLikeTypeNode =
  InterfaceTypeDefinitionNode
  | InterfaceTypeExtensionNode
  | ObjectTypeDefinitionNode
  | ObjectTypeExtensionNode;