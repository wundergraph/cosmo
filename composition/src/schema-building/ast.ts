import {
  type ConstDirectiveNode,
  type ConstValueNode,
  type DirectiveDefinitionNode,
  type EnumValueDefinitionNode,
  type FieldDefinitionNode,
  type InputValueDefinitionNode,
  type InterfaceTypeDefinitionNode,
  type InterfaceTypeExtensionNode,
  Kind,
  type NamedTypeNode,
  type NameNode,
  type ObjectTypeDefinitionNode,
  type ObjectTypeExtensionNode,
  type StringValueNode,
  type TypeNode,
} from 'graphql';
import { extractExecutableDirectiveLocations, formatDescription, stringToNameNode } from '../ast/utils';
import {
  duplicateDirectiveDefinitionLocationError,
  duplicateDirectiveDefinitionLocationErrorMessage,
  invalidDirectiveDefinitionLocationError,
  invalidDirectiveDefinitionLocationErrorMessage,
  maximumTypeNestingExceededError,
  unexpectedTypeNodeKindFatalError,
} from '../errors/errors';
import { MAXIMUM_TYPE_NESTING } from '../utils/integer-constants';
import { EXECUTABLE_DIRECTIVE_LOCATIONS } from '../utils/string-constants';
import { TYPE_SYSTEM_DIRECTIVE_LOCATIONS } from '../v1/constants/strings';
import { type DirectiveLocation } from '../types/types';
import { type ExtractDirectiveLocationsResult } from './types/results';

export type MutableDirectiveDefinitionNode = {
  arguments: MutableInputValueNode[];
  kind: Kind.DIRECTIVE_DEFINITION;
  locations: NameNode[];
  name: NameNode;
  repeatable: boolean;
  description?: StringValueNode;
};

export type MutableEnumNode = {
  kind: Kind.ENUM_TYPE_DEFINITION;
  name: NameNode;
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
  values?: MutableEnumValueNode[];
};

export function getMutableEnumNode(nameNode: NameNode): MutableEnumNode {
  return {
    kind: Kind.ENUM_TYPE_DEFINITION,
    name: { ...nameNode },
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

export function getMutableInputObjectNode(nameNode: NameNode): MutableInputObjectNode {
  return {
    kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
    name: { ...nameNode },
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

export function getMutableInterfaceNode(nameNode: NameNode): MutableInterfaceNode {
  return {
    kind: Kind.INTERFACE_TYPE_DEFINITION,
    name: { ...nameNode },
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

export function getMutableObjectNode(nameNode: NameNode): MutableObjectNode {
  return {
    kind: Kind.OBJECT_TYPE_DEFINITION,
    name: { ...nameNode },
  };
}

export type MutableScalarNode = {
  kind: Kind.SCALAR_TYPE_DEFINITION;
  name: NameNode;
  description?: StringValueNode;
  directives?: ConstDirectiveNode[];
};

export function getMutableScalarNode(nameNode: NameNode): MutableScalarNode {
  return {
    kind: Kind.SCALAR_TYPE_DEFINITION,
    name: { ...nameNode },
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
  errors.push(maximumTypeNestingExceededError(typePath));
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

export function getMutableUnionNode(nameNode: NameNode): MutableUnionNode {
  return {
    kind: Kind.UNION_TYPE_DEFINITION,
    name: { ...nameNode },
  };
}

export type MutableDefinitionNode =
  | MutableDirectiveDefinitionNode
  | MutableEnumNode
  | MutableInputObjectNode
  | MutableInterfaceNode
  | MutableObjectNode
  | MutableScalarNode
  | MutableUnionNode;

export type CompositeOutputNode =
  | InterfaceTypeDefinitionNode
  | InterfaceTypeExtensionNode
  | ObjectTypeDefinitionNode
  | ObjectTypeExtensionNode;

export function getTypeNodeNamedTypeName(typeNode: TypeNode): string {
  if (typeNode.kind === Kind.NAMED_TYPE) {
    return typeNode.name.value;
  }
  return getTypeNodeNamedTypeName(typeNode.type);
}

export function getNamedTypeNode(typeNode: TypeNode): TypeNode {
  if (typeNode.kind === Kind.NAMED_TYPE) {
    return typeNode;
  }
  return getNamedTypeNode(typeNode.type);
}

export function extractDirectiveLocations(node: DirectiveDefinitionNode): ExtractDirectiveLocationsResult {
  const errors: Array<Error> = [];
  const locations = new Set<DirectiveLocation>();
  const handledLocations = new Set<DirectiveLocation>();
  for (const locationNode of node.locations) {
    const locationName = locationNode.value;
    if (handledLocations.has(locationName)) {
      continue;
    }
    if (!EXECUTABLE_DIRECTIVE_LOCATIONS.has(locationName) && !TYPE_SYSTEM_DIRECTIVE_LOCATIONS.has(locationName)) {
      errors.push(invalidDirectiveDefinitionLocationError(locationName));
      handledLocations.add(locationName);
      continue;
    }
    if (locations.has(locationName)) {
      errors.push(duplicateDirectiveDefinitionLocationError(locationName));
      handledLocations.add(locationName);
      continue;
    }
    locations.add(locationName);
  }
  return {
    errors,
    locations,
  };
}
