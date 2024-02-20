import {
  ConstDirectiveNode,
  DirectiveDefinitionNode,
  EnumTypeDefinitionNode,
  EnumTypeExtensionNode,
  EnumValueDefinitionNode,
  FieldDefinitionNode,
  InputObjectTypeDefinitionNode,
  InputObjectTypeExtensionNode,
  InputValueDefinitionNode,
  InterfaceTypeDefinitionNode,
  InterfaceTypeExtensionNode,
  Kind,
  NamedTypeNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  OperationTypeNode,
  ScalarTypeDefinitionNode,
  ScalarTypeExtensionNode,
  SchemaDefinitionNode,
  StringValueNode,
  TypeNode,
  UnionTypeDefinitionNode,
  UnionTypeExtensionNode,
} from 'graphql';
import {
  ArgumentData,
  ChildData,
  DefinitionWithFieldsData,
  EnumDefinitionData,
  EnumValueData,
  FieldData,
  InputObjectDefinitionData,
  InputValueData,
  ParentDefinitionData,
  ScalarDefinitionData,
  SchemaData,
  UnionDefinitionData,
} from './type-definition-data';
import {
  getMutableEnumNode,
  getMutableEnumValueNode,
  getMutableFieldNode,
  getMutableInputObjectNode,
  getMutableInputValueNode,
  getMutableInterfaceNode,
  getMutableObjectExtensionNode,
  getMutableObjectNode,
  getMutableScalarNode,
  getMutableTypeNode,
  getMutableUnionNode,
} from './ast';
import {
  formatDescription,
  InputObjectTypeNode,
  InterfaceTypeNode,
  ObjectTypeNode,
  SchemaNode,
  setToNamedTypeNodeArray,
  UnionTypeNode,
} from '../ast/utils';
import {
  duplicateArgumentsError,
  duplicateDirectiveArgumentDefinitionErrorMessage,
  duplicateInterfaceError,
  duplicateUnionMemberError,
  duplicateUnionMemberExtensionError,
  invalidDirectiveError,
  invalidDirectiveLocationErrorMessage,
  invalidKeyDirectiveArgumentErrorMessage,
  invalidRepeatedDirectiveErrorMessage,
  noDefinedUnionMembersError,
  undefinedDirectiveErrorMessage,
  undefinedRequiredArgumentsErrorMessage,
  unexpectedDirectiveArgumentErrorMessage,
  unexpectedDirectiveArgumentsErrorMessage,
} from '../errors/errors';
import {
  AUTHENTICATED,
  EXTERNAL,
  IGNORED_PARENT_DIRECTIVES,
  KEY,
  REQUIRES_SCOPES,
  ROOT_TYPES,
  SHAREABLE,
} from '../utils/string-constants';
import {
  EnumExtensionData,
  ExtensionWithFieldsData,
  InputObjectExtensionData,
  ObjectExtensionData,
  ParentExtensionData,
  ScalarExtensionData,
  UnionExtensionData,
} from './type-extension-data';
import { getNamedTypeForChild } from './type-merging';
import { areNodeKindAndDirectiveLocationCompatible, getDirectiveDefinitionArgumentSets } from '../normalization/utils';
import {
  AuthorizationData,
  generateRequiresScopesDirective,
  generateSimpleDirective,
  getEntriesNotInHashSet,
  getValueOrDefault,
  mapToArrayOfValues,
} from '../utils/utils';
import {
  BASE_SCALARS,
  INHERITABLE_DIRECTIVE_NAMES,
  V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME,
} from '../utils/constants';

type IsNodeExternalOrShareableResult = {
  isExternal: boolean;
  isShareable: boolean;
};

export function isNodeExternalOrShareable(
  node: ObjectTypeNode | FieldDefinitionNode,
  areAllFieldsShareable: boolean,
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
): IsNodeExternalOrShareableResult {
  const result: IsNodeExternalOrShareableResult = {
    isExternal: directivesByDirectiveName.has(EXTERNAL),
    isShareable: areAllFieldsShareable || directivesByDirectiveName.has(SHAREABLE),
  };
  if (!node.directives?.length) {
    return result;
  }
  for (const directiveNode of node.directives) {
    const directiveName = directiveNode.name.value;
    if (directiveName === EXTERNAL) {
      result.isExternal = true;
      continue;
    }
    if (directiveName === SHAREABLE) {
      result.isShareable = true;
    }
  }
  return result;
}

export function getDefinedArgumentsForDirective(
  directiveNode: ConstDirectiveNode,
  argumentTypeNodeByArgumentName: Map<string, TypeNode>,
  requiredArguments: Set<string>,
  hostPath: string,
  errorMessages: string[],
): Set<string> {
  const directiveArguments = directiveNode.arguments || [];
  const directiveName = directiveNode.name.value;
  const definedArguments = new Set<string>();
  const handledDuplicateArguments = new Set<string>();
  for (const argument of directiveArguments) {
    const argumentName = argument.name.value;
    // If an argument is observed more than once, it is a duplication error.
    // However, the error should only propagate once.
    if (definedArguments.has(argumentName)) {
      if (!handledDuplicateArguments.has(argumentName)) {
        handledDuplicateArguments.add(argumentName);
        errorMessages.push(duplicateDirectiveArgumentDefinitionErrorMessage(directiveName, hostPath, argumentName));
      }
      continue;
    }
    const argumentTypeNode = argumentTypeNodeByArgumentName.get(argumentName);
    if (!argumentTypeNode) {
      errorMessages.push(unexpectedDirectiveArgumentErrorMessage(directiveName, argumentName));
      continue;
    }
    // TODO validate argument values
    // if (argumentTypeNode) {
    //   errorMessages.push(invalidDirectiveArgumentTypeErrorMessage(
    //     requiredArguments.has(directiveName), argumentName, argumentTypeNode, argument.value.kind),
    //   );
    // }
    definedArguments.add(argumentName);
  }
  return definedArguments;
}

export function getDirectiveValidationErrors(
  directiveNode: ConstDirectiveNode,
  hostKind: Kind,
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  hostPath: string,
  isArgument = false,
): string[] {
  const directiveName = directiveNode.name.value;
  const directiveDefinition =
    directiveDefinitionByDirectiveName.get(directiveName) ||
    V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME.get(directiveName);
  const errorMessages: string[] = [];
  if (!directiveDefinition) {
    errorMessages.push(undefinedDirectiveErrorMessage(directiveName, hostPath));
    return errorMessages;
  }
  const argumentTypeNodeByArgumentName = new Map<string, TypeNode>();
  const requiredArguments = new Set<string>();
  getDirectiveDefinitionArgumentSets(
    directiveDefinition.arguments || [],
    argumentTypeNodeByArgumentName,
    requiredArguments,
  );
  if (!areNodeKindAndDirectiveLocationCompatible(hostKind, directiveDefinition, isArgument)) {
    errorMessages.push(
      invalidDirectiveLocationErrorMessage(hostPath, isArgument ? Kind.ARGUMENT : hostKind, directiveName),
    );
  }
  if (!directiveDefinition.repeatable && directivesByDirectiveName.get(directiveName)) {
    const handledRepeatedDirectives = handledRepeatedDirectivesByHostPath.get(hostPath);
    // Add the directive name to the existing set (if other invalid repeated directives exist) or a new set
    // If the directive name exists as a value on the host path key, the repeatable error has been handled
    if (!handledRepeatedDirectives) {
      handledRepeatedDirectivesByHostPath.set(hostPath, new Set<string>([directiveName]));
    } else if (!handledRepeatedDirectives.has(directiveName)) {
      handledRepeatedDirectives.add(directiveName);
      errorMessages.push(invalidRepeatedDirectiveErrorMessage(directiveName, hostPath));
    }
  }
  if (!directiveDefinition.arguments?.length) {
    if (directiveNode.arguments?.length) {
      errorMessages.push(unexpectedDirectiveArgumentsErrorMessage(directiveNode, hostPath));
    }
    return errorMessages;
  }
  if (!directiveNode.arguments?.length) {
    if (requiredArguments.size > 0) {
      errorMessages.push(undefinedRequiredArgumentsErrorMessage(directiveName, hostPath, [...requiredArguments]));
    }
    return errorMessages;
  }
  const definedArguments = getDefinedArgumentsForDirective(
    directiveNode,
    argumentTypeNodeByArgumentName,
    requiredArguments,
    hostPath,
    errorMessages,
  );
  const missingRequiredArguments = getEntriesNotInHashSet(requiredArguments, definedArguments);
  if (missingRequiredArguments.length > 0) {
    errorMessages.push(
      undefinedRequiredArgumentsErrorMessage(directiveName, hostPath, [...requiredArguments], missingRequiredArguments),
    );
  }
  return errorMessages;
}

export function extractDirectives(
  node:
    | EnumValueDefinitionNode
    | InputObjectTypeNode
    | InputValueDefinitionNode
    | InterfaceTypeNode
    | ObjectTypeNode
    | SchemaNode
    | UnionTypeNode,
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  hostPath: string,
  isArgument = false,
): Map<string, ConstDirectiveNode[]> {
  if (!node.directives) {
    return directivesByDirectiveName;
  }
  const entityKeys = new Set<string>();
  for (const directiveNode of node.directives) {
    const errorMessages = getDirectiveValidationErrors(
      directiveNode,
      node.kind,
      directivesByDirectiveName,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      hostPath,
      isArgument,
    );
    const directiveName = directiveNode.name.value;
    if (errorMessages.length > 0) {
      errors.push(invalidDirectiveError(directiveName, hostPath, errorMessages));
      continue;
    }
    if (IGNORED_PARENT_DIRECTIVES.has(directiveName)) {
      continue;
    }
    if (directiveName === KEY) {
      // The argument was validated earlier
      const entityKey = (directiveNode.arguments![0].value as StringValueNode).value;
      if (entityKeys.has(entityKey)) {
        continue;
      }
      entityKeys.add(entityKey);
    }
    const existingDirectives = directivesByDirectiveName.get(directiveName);
    existingDirectives
      ? existingDirectives.push(directiveNode)
      : directivesByDirectiveName.set(directiveName, [directiveNode]);
  }
  return directivesByDirectiveName;
}

export function extractArguments(
  argumentDataByArgumentName: Map<string, ArgumentData>,
  node: FieldDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  parentsWithChildArguments: Set<string>,
  parentTypeName: string,
  subgraphName: string,
): Map<string, ArgumentData> {
  if (!node.arguments?.length) {
    return argumentDataByArgumentName;
  }
  const fieldName = node.name.value;
  const fieldPath = `${parentTypeName}.${fieldName}`;
  parentsWithChildArguments.add(parentTypeName);
  const duplicatedArguments = new Set<string>();
  for (const argumentNode of node.arguments) {
    const argumentName = argumentNode.name.value;
    if (argumentDataByArgumentName.has(argumentName)) {
      duplicatedArguments.add(argumentName);
      continue;
    }
    upsertArgumentDataByNode(
      argumentDataByArgumentName,
      argumentNode,
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      parentTypeName,
      fieldName,
      subgraphName,
    );
  }
  if (duplicatedArguments.size > 0) {
    errors.push(duplicateArgumentsError(fieldPath, [...duplicatedArguments]));
  }
  return argumentDataByArgumentName;
}

export function upsertArgumentDataByNode(
  argumentDataByArgumentName: Map<string, ArgumentData>,
  node: InputValueDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  parentTypeName: string,
  fieldName: string,
  subgraphName: string,
) {
  const name = node.name.value;
  const hostPath = `${parentTypeName}.${fieldName}`;
  argumentDataByArgumentName.set(name, {
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      `${hostPath}(${name}: ...)`,
      true,
    ),
    name,
    node: getMutableInputValueNode(node, parentTypeName, fieldName),
    requiredSubgraphNames: new Set<string>([subgraphName]),
    subgraphNames: new Set<string>([subgraphName]),
    type: getMutableTypeNode(node.type, hostPath),
    defaultValue: node.defaultValue,
    description: formatDescription(node.description),
  });
}

export function upsertEnumDefinitionDataByNode(
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>,
  node: EnumTypeDefinitionNode,
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
) {
  const typeName = node.name.value;
  parentDefinitionDataByTypeName.set(typeName, {
    appearances: 1,
    directivesByDirectiveName,
    kind: node.kind,
    node: getMutableEnumNode(node),
    typeName,
    enumValueDataByValueName: new Map<string, EnumValueData>(),
    description: formatDescription(node.description),
  });
}

export function upsertEnumExtensionDataByNode(
  parentExtensionDataByTypeName: Map<string, ParentExtensionData>,
  node: EnumTypeExtensionNode,
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
) {
  const typeName = node.name.value;
  parentExtensionDataByTypeName.set(typeName, {
    directivesByDirectiveName,
    enumValueDataByValueName: new Map<string, EnumValueData>(),
    kind: node.kind,
    typeName,
  });
}

export function upsertEnumValueDataByNode(
  enumValueDataByValueName: Map<string, EnumValueData>,
  node: EnumValueDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  parentTypeName: string,
) {
  const name = node.name.value;
  enumValueDataByValueName.set(name, {
    appearances: 1,
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      `${parentTypeName}.${name}`,
    ),
    name,
    node: getMutableEnumValueNode(node),
    parentTypeName,
    description: formatDescription(node.description),
  });
}

export function addInheritedDirectivesToFieldData(
  parentDirectivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
  fieldDirectivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
) {
  for (const directiveName of INHERITABLE_DIRECTIVE_NAMES) {
    if (parentDirectivesByDirectiveName.get(directiveName)) {
      getValueOrDefault(fieldDirectivesByDirectiveName, directiveName, () => [generateSimpleDirective(directiveName)]);
    }
  }
  return fieldDirectivesByDirectiveName;
}

export function upsertFieldDataByNode(
  fieldDataByFieldName: Map<string, FieldData>,
  node: FieldDefinitionNode,
  errors: Error[],
  argumentDataByArgumentName: Map<string, ArgumentData>,
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
  parentTypeName: string,
  subgraphName: string,
  isSubgraphVersionTwo: boolean,
): FieldData {
  const name = node.name.value;
  const fieldPath = `${parentTypeName}.${name}`;
  const isNodeExternalOrShareableResult = isNodeExternalOrShareable(
    node,
    !isSubgraphVersionTwo,
    directivesByDirectiveName,
  );
  const fieldData: FieldData = {
    argumentDataByArgumentName: argumentDataByArgumentName,
    isExternalBySubgraphName: new Map<string, boolean>([[subgraphName, isNodeExternalOrShareableResult.isExternal]]),
    isShareableBySubgraphName: new Map<string, boolean>([[subgraphName, isNodeExternalOrShareableResult.isShareable]]),
    node: getMutableFieldNode(node, parentTypeName),
    name,
    namedTypeName: getNamedTypeForChild(fieldPath, node.type),
    parentTypeName,
    subgraphNames: new Set<string>([subgraphName]),
    directivesByDirectiveName,
    description: formatDescription(node.description),
  };
  fieldDataByFieldName.set(name, fieldData);
  return fieldData;
}

export function upsertExtensionWithFieldsDataByNode(
  parentExtensionDataByTypeName: Map<string, ParentExtensionData>,
  node: InterfaceTypeDefinitionNode | InterfaceTypeExtensionNode | ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  isEntity: boolean,
) {
  const typeName = node.name.value;
  const kind = convertKindForExtension(node);
  switch (kind) {
    case Kind.INTERFACE_TYPE_EXTENSION:
      parentExtensionDataByTypeName.set(typeName, {
        directivesByDirectiveName: extractDirectives(
          node,
          new Map<string, ConstDirectiveNode[]>(),
          errors,
          directiveDefinitionByDirectiveName,
          handledRepeatedDirectivesByHostPath,
          typeName,
        ),
        fieldDataByFieldName: new Map<string, FieldData>(),
        implementedInterfaceTypeNames: extractImplementedInterfaceTypeNames(node, new Set<string>(), errors),
        isEntity,
        kind,
        typeName,
      });
      return;
    default:
      parentExtensionDataByTypeName.set(typeName, {
        directivesByDirectiveName: extractDirectives(
          node,
          new Map<string, ConstDirectiveNode[]>(),
          errors,
          directiveDefinitionByDirectiveName,
          handledRepeatedDirectivesByHostPath,
          typeName,
        ),
        fieldDataByFieldName: new Map<string, FieldData>(),
        implementedInterfaceTypeNames: extractImplementedInterfaceTypeNames(node, new Set<string>(), errors),
        isEntity,
        kind,
        node: getMutableObjectExtensionNode(node as ObjectTypeExtensionNode),
        typeName,
      });
  }
}

export function upsertInputObjectDefinitionDataByNode(
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>,
  node: InputObjectTypeDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
) {
  const typeName = node.name.value;
  parentDefinitionDataByTypeName.set(typeName, {
    appearances: 1,
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      typeName,
    ),
    inputValueDataByValueName: new Map<string, InputValueData>(),
    kind: node.kind,
    node: getMutableInputObjectNode(node),
    typeName,
    description: formatDescription(node.description),
  });
}

export function upsertInputObjectExtensionDataByNode(
  parentExtensionDataByTypeName: Map<string, ParentExtensionData>,
  node: InputObjectTypeExtensionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
) {
  const typeName = node.name.value;
  parentExtensionDataByTypeName.set(typeName, {
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      typeName,
    ),
    inputValueDataByValueName: new Map<string, InputValueData>(),
    kind: node.kind,
    typeName,
  });
}

export function upsertInputValueDataByNode(
  inputValueDataByValueName: Map<string, InputValueData>,
  node: InputValueDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  parentTypeName: string,
) {
  const name = node.name.value;
  inputValueDataByValueName.set(name, {
    appearances: 1,
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      `${parentTypeName}.${name}`,
    ),
    name,
    node: getMutableInputValueNode(node, parentTypeName, name),
    parentTypeName,
    description: formatDescription(node.description),
  });
}

export function upsertInterfaceDefinitionDataByNode(
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>,
  node: InterfaceTypeDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  isEntity: boolean,
  subgraphName: string,
) {
  const typeName = node.name.value;
  parentDefinitionDataByTypeName.set(typeName, {
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      typeName,
    ),
    fieldDataByFieldName: new Map<string, FieldData>(),
    isEntity,
    implementedInterfaceTypeNames: extractImplementedInterfaceTypeNames(node, new Set<string>(), errors),
    kind: node.kind,
    node: getMutableInterfaceNode(node),
    subgraphNames: new Set<string>([subgraphName]),
    typeName,
    description: formatDescription(node.description),
  });
}

export function upsertObjectDefinitionDataByNode(
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>,
  node: ObjectTypeDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  isEntity: boolean,
  isRootType: boolean,
  subgraphName: string,
) {
  const typeName = node.name.value;
  parentDefinitionDataByTypeName.set(typeName, {
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      typeName,
    ),
    fieldDataByFieldName: new Map<string, FieldData>(),
    isEntity,
    isRootType,
    implementedInterfaceTypeNames: extractImplementedInterfaceTypeNames(node, new Set<string>(), errors),
    kind: node.kind,
    node: getMutableObjectNode(node),
    subgraphNames: new Set<string>([subgraphName]),
    typeName,
    description: formatDescription(node.description),
  });
}

export function upsertScalarDefinitionDataByNode(
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>,
  node: ScalarTypeDefinitionNode,
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
) {
  const typeName = node.name.value;
  parentDefinitionDataByTypeName.set(typeName, {
    directivesByDirectiveName,
    kind: node.kind,
    node: getMutableScalarNode(node),
    typeName,
    description: formatDescription(node.description),
  });
}

export function upsertScalarExtensionDataByNode(
  parentExtensionDataByTypeName: Map<string, ParentExtensionData>,
  node: ScalarTypeExtensionNode,
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
) {
  const typeName = node.name.value;
  parentExtensionDataByTypeName.set(typeName, {
    directivesByDirectiveName,
    kind: node.kind,
    typeName,
  });
}

export function extractUniqueUnionMembers(
  members: readonly NamedTypeNode[],
  membersByMemberTypeName: Map<string, NamedTypeNode>,
  errors: Error[],
  unionTypeName: string,
  abstractToConcreteTypeNames: Map<string, Set<string>>,
  referencedTypeNames: Set<string>,
): Map<string, NamedTypeNode> {
  for (const member of members) {
    const memberTypeName = member.name.value;
    if (membersByMemberTypeName.has(memberTypeName)) {
      errors.push(duplicateUnionMemberError(memberTypeName, unionTypeName));
      continue;
    }
    const concreteTypes = abstractToConcreteTypeNames.get(unionTypeName);
    if (concreteTypes) {
      concreteTypes.add(memberTypeName);
    } else {
      abstractToConcreteTypeNames.set(unionTypeName, new Set<string>([memberTypeName]));
    }
    if (!BASE_SCALARS.has(memberTypeName)) {
      referencedTypeNames.add(memberTypeName);
    }
    membersByMemberTypeName.set(memberTypeName, member);
  }
  return membersByMemberTypeName;
}

export function upsertUnionDefinitionDataByNode(
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>,
  node: UnionTypeDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  abstractToConcreteTypeNames: Map<string, Set<string>>,
  referencedTypeNames: Set<string>,
) {
  const typeName = node.name.value;
  if (!node.types?.length) {
    errors.push(noDefinedUnionMembersError(typeName));
    return;
  }
  parentDefinitionDataByTypeName.set(typeName, {
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      typeName,
    ),
    kind: node.kind,
    memberByMemberTypeName: extractUniqueUnionMembers(
      node.types,
      new Map<string, NamedTypeNode>(),
      errors,
      typeName,
      abstractToConcreteTypeNames,
      referencedTypeNames,
    ),
    node: getMutableUnionNode(node),
    typeName,
    description: formatDescription(node.description),
  });
}

export function upsertUnionExtensionDataByNode(
  parentExtensionDataByTypeName: Map<string, ParentExtensionData>,
  node: UnionTypeExtensionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  abstractToConcreteTypeNames: Map<string, Set<string>>,
  referencedTypeNames: Set<string>,
) {
  const typeName = node.name.value;
  parentExtensionDataByTypeName.set(typeName, {
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      typeName,
    ),
    kind: node.kind,
    memberByMemberTypeName: extractUniqueUnionMembers(
      // Undefined or empty node.types is handled earlier
      node.types!,
      new Map<string, NamedTypeNode>(),
      errors,
      typeName,
      abstractToConcreteTypeNames,
      referencedTypeNames,
    ),
    typeName,
  });
}

export function isTypeNameRootType(typeName: string, operationByTypeName: Map<string, OperationTypeNode>) {
  return ROOT_TYPES.has(typeName) || operationByTypeName.has(typeName);
}

export function convertKindForExtension(
  node: InterfaceTypeDefinitionNode | InterfaceTypeExtensionNode | ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
): Kind.INTERFACE_TYPE_EXTENSION | Kind.OBJECT_TYPE_EXTENSION {
  switch (node.kind) {
    case Kind.INTERFACE_TYPE_DEFINITION:
      return Kind.INTERFACE_TYPE_EXTENSION;
    case Kind.OBJECT_TYPE_DEFINITION:
      return Kind.OBJECT_TYPE_EXTENSION;
    default:
      return node.kind;
  }
}

export function extractImplementedInterfaceTypeNames(
  node: InterfaceTypeDefinitionNode | InterfaceTypeExtensionNode | ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
  implementedInterfaceTypeNames: Set<string>,
  errors?: Error[],
): Set<string> {
  if (!node.interfaces) {
    return implementedInterfaceTypeNames;
  }
  const parentTypeName = node.name.value;
  for (const implementedInterface of node.interfaces) {
    const interfaceTypeName = implementedInterface.name.value;
    if (errors && implementedInterfaceTypeNames.has(interfaceTypeName)) {
      errors.push(duplicateInterfaceError(interfaceTypeName, parentTypeName));
      continue;
    }
    implementedInterfaceTypeNames.add(interfaceTypeName);
  }
  return implementedInterfaceTypeNames;
}

function addExtensionDirectivesToDefinition(
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
  parentExtensionData?: ParentExtensionData,
) {
  if (!parentExtensionData) {
    return;
  }
  for (const [directiveName, directives] of parentExtensionData.directivesByDirectiveName) {
    const existingDirectives = directivesByDirectiveName.get(directiveName);
    if (existingDirectives) {
      existingDirectives.push(...directives);
      continue;
    }
    directivesByDirectiveName.set(directiveName, [...directives]);
  }
}

type ChildDefinitionNode = EnumValueDefinitionNode | FieldDefinitionNode | InputValueDefinitionNode;

function addAuthorizationDirectivesToFieldData(
  authorizationDataByParentTypeName: Map<string, AuthorizationData>,
  fieldData: FieldData,
) {
  const authorizationData = authorizationDataByParentTypeName.get(fieldData.parentTypeName);
  if (!authorizationData) {
    return;
  }
  const fieldAuthorizationData = authorizationData.fieldAuthorizationDataByFieldName.get(fieldData.name);
  if (!fieldAuthorizationData) {
    return;
  }
  if (fieldAuthorizationData.requiresAuthentication) {
    const authenticatedDirective = generateSimpleDirective(AUTHENTICATED);
    fieldData.directivesByDirectiveName.set(AUTHENTICATED, [authenticatedDirective]);
  }
  if (fieldAuthorizationData.requiredScopes.length > 0) {
    const requiresScopesDirective = generateRequiresScopesDirective(fieldAuthorizationData.requiredScopes);
    fieldData.directivesByDirectiveName.set(REQUIRES_SCOPES, [requiresScopesDirective]);
  }
}

function propagateFieldDataArguments(fieldData: FieldData) {
  for (const argumentData of fieldData.argumentDataByArgumentName.values()) {
    // First propagate the argument's directives
    for (const directiveNodes of argumentData.directivesByDirectiveName.values()) {
      argumentData.node.directives.push(...directiveNodes);
    }
    fieldData.node.arguments.push(argumentData.node);
  }
}

function childMapToValueArray<V extends ChildData, N extends ChildDefinitionNode = V['node']>(
  map: Map<string, V>,
  authorizationDataByParentTypeName: Map<string, AuthorizationData>,
): N[] {
  const valueArray: ChildDefinitionNode[] = [];
  for (const childData of map.values()) {
    if (childData.node.kind === Kind.FIELD_DEFINITION) {
      const fieldData = childData as FieldData;
      addAuthorizationDirectivesToFieldData(authorizationDataByParentTypeName, fieldData);
      propagateFieldDataArguments(fieldData);
    }
    for (const directiveNodes of childData.directivesByDirectiveName.values()) {
      childData.node.directives.push(...directiveNodes);
    }
    valueArray.push(childData.node);
  }
  return valueArray as N[];
}

function getValidFlattenedDirectiveArray(
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  hostPath: string,
): ConstDirectiveNode[] {
  const flattenedArray: ConstDirectiveNode[] = [];
  for (const [directiveName, directiveNodes] of directivesByDirectiveName) {
    const directiveDefinition =
      directiveDefinitionByDirectiveName.get(directiveName) ||
      V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME.get(directiveName);
    if (!directiveDefinition) {
      continue;
    }
    if (!directiveDefinition.repeatable && directiveNodes.length > 1) {
      errors.push(
        invalidDirectiveError(directiveName, hostPath, [invalidRepeatedDirectiveErrorMessage(directiveName, hostPath)]),
      );
      continue;
    }
    if (directiveName !== KEY) {
      flattenedArray.push(...directiveNodes);
      continue;
    }
    const normalizedDirectiveNodes: ConstDirectiveNode[] = [];
    const entityKeys = new Set<string>();
    const errorMessages: string[] = [];
    for (const keyDirectiveNode of directiveNodes) {
      const directiveValue = keyDirectiveNode.arguments![0].value;
      if (directiveValue.kind !== Kind.STRING) {
        errorMessages.push(invalidKeyDirectiveArgumentErrorMessage(directiveValue.kind));
        continue;
      }
      const entityKey = directiveValue.value;
      if (entityKeys.has(entityKey)) {
        continue;
      }
      entityKeys.add(entityKey);
      flattenedArray.push(keyDirectiveNode);
      normalizedDirectiveNodes.push(keyDirectiveNode);
    }
    directivesByDirectiveName.set(directiveName, normalizedDirectiveNodes);
    if (errorMessages.length > 0) {
      errors.push(invalidDirectiveError(directiveName, hostPath, errorMessages));
    }
  }
  return flattenedArray;
}

function mergeUniqueUnionMembers(
  unionDefinitionData: UnionDefinitionData,
  errors: Error[],
  unionExtensionData?: UnionExtensionData,
) {
  if (!unionExtensionData) {
    return;
  }
  const definitionMembers = unionDefinitionData.memberByMemberTypeName;
  const extensionMembers = unionExtensionData.memberByMemberTypeName;
  const typeName = unionDefinitionData.typeName;
  for (const [memberName, namedTypeNode] of extensionMembers) {
    if (!definitionMembers.has(memberName)) {
      definitionMembers.set(memberName, namedTypeNode);
      continue;
    }
    errors.push(duplicateUnionMemberExtensionError(memberName, typeName));
  }
}

export function getEnumNodeByData(
  enumDefinitionData: EnumDefinitionData,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  authorizationDataByParentTypeName: Map<string, AuthorizationData>,
  enumExtensionData?: EnumExtensionData,
) {
  addExtensionDirectivesToDefinition(enumDefinitionData.directivesByDirectiveName, enumExtensionData);
  enumDefinitionData.node.directives = getValidFlattenedDirectiveArray(
    enumDefinitionData.directivesByDirectiveName,
    errors,
    directiveDefinitionByDirectiveName,
    enumDefinitionData.typeName,
  );
  enumDefinitionData.node.values = childMapToValueArray(
    enumDefinitionData.enumValueDataByValueName,
    authorizationDataByParentTypeName,
  );
  return enumDefinitionData.node;
}

export function getInputObjectNodeByData(
  inputObjectDefinitionData: InputObjectDefinitionData,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  authorizationDataByParentTypeName: Map<string, AuthorizationData>,
  inputObjectExtensionData?: InputObjectExtensionData,
) {
  addExtensionDirectivesToDefinition(inputObjectDefinitionData.directivesByDirectiveName, inputObjectExtensionData);
  inputObjectDefinitionData.node.directives = getValidFlattenedDirectiveArray(
    inputObjectDefinitionData.directivesByDirectiveName,
    errors,
    directiveDefinitionByDirectiveName,
    inputObjectDefinitionData.typeName,
  );
  inputObjectDefinitionData.node.fields = childMapToValueArray(
    inputObjectDefinitionData.inputValueDataByValueName,
    authorizationDataByParentTypeName,
  );
  return inputObjectDefinitionData.node;
}

export function getParentWithFieldsNodeByData(
  parentWithFieldsData: DefinitionWithFieldsData | ObjectExtensionData,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  authorizationDataByParentTypeName: Map<string, AuthorizationData>,
  parentExtensionWithFieldsData?: ExtensionWithFieldsData,
): ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode | ObjectTypeExtensionNode {
  addExtensionDirectivesToDefinition(parentWithFieldsData.directivesByDirectiveName, parentExtensionWithFieldsData);
  parentWithFieldsData.node.directives = getValidFlattenedDirectiveArray(
    parentWithFieldsData.directivesByDirectiveName,
    errors,
    directiveDefinitionByDirectiveName,
    parentWithFieldsData.typeName,
  );
  parentWithFieldsData.node.fields = childMapToValueArray(
    parentWithFieldsData.fieldDataByFieldName,
    authorizationDataByParentTypeName,
  );
  parentWithFieldsData.node.interfaces = setToNamedTypeNodeArray(parentWithFieldsData.implementedInterfaceTypeNames);
  return parentWithFieldsData.node;
}

export function getScalarNodeByData(
  scalarDefinitionData: ScalarDefinitionData,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  scalarExtensionData?: ScalarExtensionData,
) {
  addExtensionDirectivesToDefinition(scalarDefinitionData.directivesByDirectiveName, scalarExtensionData);
  scalarDefinitionData.node.directives = getValidFlattenedDirectiveArray(
    scalarDefinitionData.directivesByDirectiveName,
    errors,
    directiveDefinitionByDirectiveName,
    scalarDefinitionData.typeName,
  );
  return scalarDefinitionData.node;
}

export function getSchemaNodeByData(
  schemaData: SchemaData,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
): SchemaDefinitionNode {
  return {
    description: schemaData.description,
    directives: getValidFlattenedDirectiveArray(
      schemaData.directivesByDirectiveName,
      errors,
      directiveDefinitionByDirectiveName,
      schemaData.typeName,
    ),
    kind: schemaData.kind,
    operationTypes: mapToArrayOfValues(schemaData.operationTypes),
  };
}

export function getUnionNodeByData(
  unionDefinitionData: UnionDefinitionData,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  unionExtensionData?: UnionExtensionData,
) {
  mergeUniqueUnionMembers(unionDefinitionData, errors, unionExtensionData);
  addExtensionDirectivesToDefinition(unionDefinitionData.directivesByDirectiveName, unionExtensionData);
  unionDefinitionData.node.directives = getValidFlattenedDirectiveArray(
    unionDefinitionData.directivesByDirectiveName,
    errors,
    directiveDefinitionByDirectiveName,
    unionDefinitionData.typeName,
  );
  unionDefinitionData.node.types = mapToArrayOfValues(unionDefinitionData.memberByMemberTypeName);
  return unionDefinitionData.node;
}

export function removeInheritableDirectivesFromParentWithFieldsData(
  parentData: ParentDefinitionData | ParentExtensionData,
) {
  for (const directiveName of INHERITABLE_DIRECTIVE_NAMES) {
    parentData.directivesByDirectiveName.delete(directiveName);
  }
}
