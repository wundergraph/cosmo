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
import { EXTERNAL, IGNORED_PARENT_DIRECTIVES, KEY, ROOT_TYPES, SHAREABLE } from '../utils/string-constants';
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
import { getEntriesNotInHashSet, mapToArrayOfValues } from '../utils/utils';
import { BASE_SCALARS, V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME } from '../utils/constants';

type IsNodeExternalOrShareableResult = {
  isExternal: boolean;
  isShareable: boolean;
};

export function isNodeExternalOrShareable(
  node: ObjectTypeNode | FieldDefinitionNode, areAllFieldsShareable: boolean,
): IsNodeExternalOrShareableResult {
  const result: IsNodeExternalOrShareableResult = { isExternal: false, isShareable: areAllFieldsShareable };
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
  for (const argument of directiveArguments) {
    const argumentName = argument.name.value;
    const argumentTypeNode = argumentTypeNodeByArgumentName.get(argumentName);
    if (!argumentTypeNode) {
      errorMessages.push(unexpectedDirectiveArgumentErrorMessage(directiveName, argumentName));
      continue;
    }
    if (definedArguments.has(argumentName)) {
      errorMessages.push(duplicateDirectiveArgumentDefinitionErrorMessage(directiveName, hostPath, argumentName));
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
  hostPath: string,
  isArgument = false,
): string[] {
  const directiveName = directiveNode.name.value;
  const directiveDefinition = directiveDefinitionByDirectiveName.get(directiveName) ||
    V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME.get(directiveName);
  const errorMessages: string[] = [];
  if (!directiveDefinition) {
    errorMessages.push(undefinedDirectiveErrorMessage(directiveName, hostPath));
    return errorMessages;
  }
  const argumentTypeNodeByArgumentName = new Map<string, TypeNode>();
  const requiredArguments = new Set<string>();
  getDirectiveDefinitionArgumentSets(
    directiveDefinition.arguments || [], argumentTypeNodeByArgumentName, requiredArguments,
  );
  if (!areNodeKindAndDirectiveLocationCompatible(hostKind, directiveDefinition, isArgument)) {
    errorMessages.push(invalidDirectiveLocationErrorMessage(
      hostPath, isArgument ? Kind.ARGUMENT : hostKind, directiveName));
  }
  if (!directiveDefinition.repeatable && directivesByDirectiveName.get(directiveName)) {
    errorMessages.push(invalidRepeatedDirectiveErrorMessage(directiveName, hostPath));
  }
  if (!directiveDefinition.arguments?.length) {
    if (directiveNode.arguments?.length) {
      errorMessages.push(unexpectedDirectiveArgumentsErrorMessage(directiveNode, hostPath));
    }
    return errorMessages;
  }
  if (!directiveNode.arguments?.length) {
    if (requiredArguments.size > 0) {
      errorMessages.push(
        undefinedRequiredArgumentsErrorMessage(directiveName, hostPath, [...requiredArguments]),
      );
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
    errorMessages.push(undefinedRequiredArgumentsErrorMessage(
      directiveName,
      hostPath,
      [...requiredArguments],
      missingRequiredArguments,
    ));
  }
  return errorMessages;
}

function getDirectiveHostPath(
  node:
    | EnumValueDefinitionNode
    | InputObjectTypeNode
    | InputValueDefinitionNode
    | InterfaceTypeNode
    | ObjectTypeNode
    | SchemaNode
    | UnionTypeNode,
  parentPath: string,
  isArgument: boolean,
): string {
  switch (node.kind) {
    case Kind.ENUM_VALUE_DEFINITION:
      return `${parentPath}.${node.name.value}`;
    case Kind.INPUT_VALUE_DEFINITION:
      return isArgument ? `${parentPath}(${node.name.value}: ...)` : `${parentPath}.${node.name.value}`
    default:
      return parentPath;
  }
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
    existingDirectives ?
      existingDirectives.push(directiveNode) : directivesByDirectiveName.set(directiveName, [directiveNode]);
  }
  return directivesByDirectiveName;
}

export function extractArguments(
  argumentDataByArgumentName: Map<string, ArgumentData>,
  node: FieldDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
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
      `${hostPath}(${name}: ...)`,
      true
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
      `${parentTypeName}.${name}`,
    ),
    name,
    node: getMutableEnumValueNode(node),
    parentTypeName,
    description: formatDescription(node.description),
  });
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
    node, !isSubgraphVersionTwo,
  );
  const fieldData: FieldData = {
    argumentDataByArgumentName: argumentDataByArgumentName,
    isExternalBySubgraphName: new Map<string, boolean>([
      [subgraphName, isNodeExternalOrShareableResult.isExternal],
    ]),
    isShareableBySubgraphName: new Map<string, boolean>([
      [subgraphName, isNodeExternalOrShareableResult.isShareable],
    ]),
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
) {
  const typeName = node.name.value;
  parentDefinitionDataByTypeName.set(typeName, {
    appearances: 1,
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      typeName
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
) {
  const typeName = node.name.value;
  parentExtensionDataByTypeName.set(typeName, {
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
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
      typeName
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
      node, new Map<string, ConstDirectiveNode[]>(), errors, directiveDefinitionByDirectiveName, typeName,
    ),
    kind: node.kind,
    memberByMemberTypeName: extractUniqueUnionMembers(
      node.types, new Map<string, NamedTypeNode>(), errors, typeName, abstractToConcreteTypeNames, referencedTypeNames,
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
  abstractToConcreteTypeNames: Map<string, Set<string>>,
  referencedTypeNames: Set<string>,
) {
  const typeName = node.name.value;
  parentExtensionDataByTypeName.set(typeName, {
    directivesByDirectiveName: extractDirectives(
      node, new Map<string, ConstDirectiveNode[]>(), errors, directiveDefinitionByDirectiveName, typeName,
    ),
    kind: node.kind,
    memberByMemberTypeName: extractUniqueUnionMembers( // Undefined or empty node.types is handled earlier
      node.types!, new Map<string, NamedTypeNode>(), errors, typeName, abstractToConcreteTypeNames, referencedTypeNames,
    ),
    typeName,
  });
}

export function isTypeNameRootType(typeName: string, operationByTypeName: Map<string, OperationTypeNode>) {
  return ROOT_TYPES.has(typeName) || operationByTypeName.has(typeName);
}

export function convertKindForExtension(
  node: InterfaceTypeDefinitionNode |
    InterfaceTypeExtensionNode |
    ObjectTypeDefinitionNode |
    ObjectTypeExtensionNode,
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

function addExtensionDirectivesToDefinition(directivesByDirectiveName: Map<string, ConstDirectiveNode[]>, parentExtensionData?: ParentExtensionData) {
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

// function validateChildDirectives(
//   child: ChildData,
//   errors: Error[],
//   directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
//   hostPath: string,
// ) {
//   const childKind = child.node.kind;
//   for (const [directiveName, directives] of child.directivesByDirectiveName) {
//     const definition = directiveDefinitionByDirectiveName.get(directiveName);
//     if (!definition) {
//       errors.push(undefinedDirectiveError(directiveName, hostPath));
//       continue;
//     }
//     const allArguments = new Set<string>();
//     const requiredArguments = new Set<string>();
//     getDirectiveDefinitionArgumentSets(definition.arguments || [], allArguments, requiredArguments);
//     const errorMessages: string[] = [];
//     for (const directive of directives) {
//       if (!areNodeKindAndDirectiveLocationCompatible(childKind, definition)) {
//         errorMessages.push(invalidDirectiveLocationErrorMessage(hostPath, childKind, directiveName));
//       }
//       if (!definition.repeatable && directives.length > 1) {
//         errorMessages.push(invalidRepeatedDirectiveErrorMessage(directiveName, hostPath));
//       }
//       if (!definition.arguments || definition.arguments.length < 1) {
//         if (directive.arguments && directive.arguments.length > 0) {
//           errorMessages.push(unexpectedDirectiveArgumentsErrorMessage(directive, hostPath));
//         }
//         continue;
//       }
//       if (!directive.arguments || directive.arguments.length < 1) {
//         if (requiredArguments.size > 0) {
//           errorMessages.push(undefinedRequiredArgumentsErrorMessage(directiveName, hostPath, [...requiredArguments]));
//         }
//         continue;
//       }
//       const definedArguments = getDefinedArgumentsForDirective(
//         directive.arguments,
//         allArguments,
//         directiveName,
//         hostPath,
//         errorMessages,
//       );
//       const missingRequiredArguments = getEntriesNotInHashSet(requiredArguments, definedArguments);
//       if (missingRequiredArguments.length > 0) {
//         errorMessages.push(
//           undefinedRequiredArgumentsErrorMessage(
//             directiveName,
//             hostPath,
//             [...requiredArguments],
//             missingRequiredArguments,
//           ),
//         );
//       }
//     }
//     if (errorMessages.length > 0) {
//       errors.push(invalidDirectiveError(directiveName, hostPath, errorMessages));
//     }
//   }
// }

type ChildDefinitionNode = EnumValueDefinitionNode | FieldDefinitionNode | InputValueDefinitionNode;

function childMapToValueArray<V extends ChildData, N extends ChildDefinitionNode = V['node']>(
  map: Map<string, V>,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
): N[] {
  const valueArray: ChildDefinitionNode[] = [];
  for (const childData of map.values()) {
    const childPath = `${childData.parentTypeName}.${childData.name}`;
    // TODO add authorization directives and shareable
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
    const directiveDefinition = directiveDefinitionByDirectiveName.get(directiveName) ||
      V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME.get(directiveName);
    if (!directiveDefinition) {
      continue;
    }
    if (!directiveDefinition.repeatable && directiveNodes.length > 1) {
      errors.push(invalidDirectiveError(
        directiveName, hostPath, [invalidRepeatedDirectiveErrorMessage(directiveName, hostPath)],
      ));
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
  }
  return flattenedArray;
}

// function getValidatedAndNormalizedParentDirectives(
//   parentData: ParentDefinitionData | SchemaData | ObjectExtensionData,
//   errors: Error[],
//   allDirectiveDefinitions: Map<string, DirectiveDefinitionNode>,
// ): ConstDirectiveNode[] {
//   const parentTypeName = parentData.typeName;
//   const normalizedDirectives: ConstDirectiveNode[] = [];
//   for (const [directiveName, directives] of parentData.directivesByDirectiveName) {
//     const definition = allDirectiveDefinitions.get(directiveName);
//     if (!definition) {
//       errors.push(undefinedDirectiveError(directiveName, parentTypeName));
//       continue;
//     }
//     const allArguments = new Set<string>();
//     const requiredArguments = new Set<string>();
//     getDirectiveDefinitionArgumentSets(definition.arguments || [], allArguments, requiredArguments);
//     const entityKeys = new Set<string>();
//     const errorMessages: string[] = [];
//     for (const directive of directives) {
//       if (!areNodeKindAndDirectiveLocationCompatible(parentData.kind, definition)) {
//         errorMessages.push(invalidDirectiveLocationErrorMessage(parentTypeName, parentData.kind, directiveName));
//       }
//       if (!definition.repeatable && directives.length > 1) {
//         errorMessages.push(invalidRepeatedDirectiveErrorMessage(directiveName, parentTypeName));
//       }
//       if (!definition.arguments || definition.arguments.length < 1) {
//         if (directive.arguments && directive.arguments.length > 0) {
//           errorMessages.push(unexpectedDirectiveArgumentsErrorMessage(directive, parentTypeName));
//         } else {
//           normalizedDirectives.push(directive);
//         }
//         continue;
//       }
//       if (!directive.arguments || directive.arguments.length < 1) {
//         if (requiredArguments.size > 0) {
//           errorMessages.push(
//             undefinedRequiredArgumentsErrorMessage(directiveName, parentTypeName, [...requiredArguments]),
//           );
//         } else {
//           normalizedDirectives.push(directive);
//         }
//         continue;
//       }
//       const definedArguments = getDefinedArgumentsForDirective(
//         directive.arguments,
//         allArguments,
//         directiveName,
//         parentTypeName,
//         errorMessages,
//       );
//       const missingRequiredArguments = getEntriesNotInHashSet(requiredArguments, definedArguments);
//       if (missingRequiredArguments.length > 0) {
//         errorMessages.push(
//           undefinedRequiredArgumentsErrorMessage(
//             directiveName,
//             parentTypeName,
//             [...requiredArguments],
//             missingRequiredArguments,
//           ),
//         );
//       }
//
//       // Only add unique entity keys
//       if (directiveName === KEY) {
//         const directiveKind = directive.arguments[0].value.kind;
//         if (directiveKind !== Kind.STRING) {
//           errorMessages.push(invalidKeyDirectiveArgumentErrorMessage(directiveKind));
//           continue;
//         }
//         const entityKey = directive.arguments[0].value.value;
//         if (entityKeys.has(entityKey)) {
//           continue;
//         }
//         entityKeys.add(entityKey);
//       }
//       normalizedDirectives.push(directive);
//     }
//     if (errorMessages.length > 0) {
//       errors.push(invalidDirectiveError(directiveName, parentTypeName, errorMessages));
//     }
//   }
//   return normalizedDirectives;
// }

function mergeUniqueUnionMembers(
  unionDefinitionData: UnionDefinitionData, errors: Error[], unionExtensionData?: UnionExtensionData,
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
    errors,
    directiveDefinitionByDirectiveName,
  );
  return enumDefinitionData.node;
}

export function getInputObjectNodeByData(
  inputObjectDefinitionData: InputObjectDefinitionData,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
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
    errors, directiveDefinitionByDirectiveName,
  );
  return inputObjectDefinitionData.node;
}

export function getParentWithFieldsNodeByData(
  parentWithFieldsData: DefinitionWithFieldsData | ObjectExtensionData,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
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
    parentWithFieldsData.fieldDataByFieldName, errors, directiveDefinitionByDirectiveName,
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
  ),
    unionDefinitionData.node.types = mapToArrayOfValues(unionDefinitionData.memberByMemberTypeName);
  return unionDefinitionData.node;
}