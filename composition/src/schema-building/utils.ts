import {
  ConstDirectiveNode,
  ConstValueNode,
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
  print,
  ScalarTypeDefinitionNode,
  ScalarTypeExtensionNode,
  SchemaDefinitionNode,
  StringValueNode,
  TypeNode,
  UnionTypeDefinitionNode,
  UnionTypeExtensionNode,
} from 'graphql';
import {
  ChildData,
  DefinitionData,
  DefinitionWithFieldsData,
  EnumDefinitionData,
  EnumValueData,
  FieldData,
  InputObjectDefinitionData,
  InputValueData,
  NodeData,
  ObjectDefinitionData,
  ParentDefinitionData,
  PersistedDirectiveDefinitionData,
  PersistedDirectivesData,
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
  getTypeNodeNamedTypeName,
  MutableFieldNode,
  MutableInputValueNode,
  MutableTypeDefinitionNode,
} from './ast';
import {
  formatDescription,
  InputObjectTypeNode,
  InterfaceTypeNode,
  ObjectTypeNode,
  SchemaNode,
  setToNamedTypeNodeArray,
  setToNameNodeArray,
  stringToNameNode,
  UnionTypeNode,
} from '../ast/utils';
import {
  duplicateArgumentsError,
  duplicateDirectiveArgumentDefinitionsErrorMessage,
  duplicateInterfaceError,
  duplicateUnionMemberError,
  duplicateUnionMemberExtensionError,
  fieldTypeMergeFatalError,
  incompatibleArgumentTypesError,
  incompatibleChildTypesError,
  incompatibleInputValueDefaultValuesError,
  incompatibleInputValueDefaultValueTypeError,
  incompatibleObjectExtensionOrphanBaseTypeError,
  incompatibleParentKindMergeError,
  invalidDirectiveError,
  invalidDirectiveLocationErrorMessage,
  invalidKeyDirectiveArgumentErrorMessage,
  invalidRepeatedDirectiveErrorMessage,
  invalidRepeatedFederatedDirectiveErrorMessage,
  invalidRequiredInputValueError,
  noBaseTypeExtensionError,
  noDefinedUnionMembersError,
  undefinedDirectiveErrorMessage,
  undefinedRequiredArgumentsErrorMessage,
  unexpectedDirectiveArgumentErrorMessage,
  unexpectedDirectiveArgumentsErrorMessage,
} from '../errors/errors';
import {
  AUTHENTICATED,
  BOOLEAN_SCALAR,
  DEPRECATED,
  DEPRECATED_DEFAULT_ARGUMENT_VALUE,
  DIRECTIVE_DEFINITION,
  EXTERNAL,
  FIELD,
  FLOAT_SCALAR,
  IGNORED_PARENT_DIRECTIVES,
  INACCESSIBLE,
  INT_SCALAR,
  KEY,
  MUTATION,
  QUERY,
  REASON,
  REQUIRES_SCOPES,
  ROOT_TYPES,
  SHAREABLE,
  STRING_SCALAR,
  SUBSCRIPTION,
  TAG,
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
import { getLeastRestrictiveMergedTypeNode, getMostRestrictiveMergedTypeNode } from './type-merging';
import { areNodeKindAndDirectiveLocationCompatible, getDirectiveDefinitionArgumentSets } from '../normalization/utils';
import {
  addIterableValuesToSet,
  addMapEntries,
  AuthorizationData,
  EntityInterfaceFederationData,
  generateRequiresScopesDirective,
  generateSimpleDirective,
  getAllMutualEntries,
  getEntriesNotInHashSet,
  getValueOrDefault,
  InvalidRequiredInputValueData,
  kindToTypeString,
  mapToArrayOfValues,
} from '../utils/utils';
import {
  BASE_SCALARS,
  INHERITABLE_DIRECTIVE_NAMES,
  V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME,
} from '../utils/constants';
import { FieldConfiguration } from '../router-configuration/router-configuration';
import { printTypeNode } from '@graphql-tools/merge';

export type ObjectData = ObjectDefinitionData | ObjectExtensionData;

function newPersistedDirectivesData(): PersistedDirectivesData {
  return {
    deprecatedReason: '',
    directives: new Map<string, ConstDirectiveNode[]>(),
    isDeprecated: false,
    tags: new Map<string, ConstDirectiveNode>(),
  };
}

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
  const duplicateArgumentNames = new Set<string>();
  const unexpectedArgumentNames = new Set<string>();
  for (const argument of directiveArguments) {
    const argumentName = argument.name.value;
    // If an argument is observed more than once, it is a duplication error.
    // However, the error should only propagate once.
    if (definedArguments.has(argumentName)) {
      duplicateArgumentNames.add(argumentName);
      continue;
    }
    const argumentTypeNode = argumentTypeNodeByArgumentName.get(argumentName);
    if (!argumentTypeNode) {
      unexpectedArgumentNames.add(argumentName);
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
  if (duplicateArgumentNames.size > 0) {
    errorMessages.push(
      duplicateDirectiveArgumentDefinitionsErrorMessage(directiveName, hostPath, [...duplicateArgumentNames]),
    );
  }
  if (unexpectedArgumentNames.size > 0) {
    errorMessages.push(unexpectedDirectiveArgumentErrorMessage(directiveName, [...unexpectedArgumentNames]));
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
  argumentDataByArgumentName: Map<string, InputValueData>,
  node: FieldDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  parentsWithChildArguments: Set<string>,
  originalParentTypeName: string,
  renamedParentTypeName: string,
  subgraphName: string,
): Map<string, InputValueData> {
  if (!node.arguments?.length) {
    return argumentDataByArgumentName;
  }
  const fieldName = node.name.value;
  const originalFieldPath = `${originalParentTypeName}.${fieldName}`;
  const renamedFieldPath = `${renamedParentTypeName}.${fieldName}`;
  parentsWithChildArguments.add(originalParentTypeName);
  const duplicatedArguments = new Set<string>();
  for (const argumentNode of node.arguments) {
    const argumentName = argumentNode.name.value;
    if (argumentDataByArgumentName.has(argumentName)) {
      duplicatedArguments.add(argumentName);
      continue;
    }
    addInputValueDataByNode(
      argumentDataByArgumentName,
      argumentNode,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      `${originalFieldPath}(${argumentName}: ...)`,
      subgraphName,
      errors,
      `${renamedFieldPath}(${argumentName}: ...)`,
    );
  }
  if (duplicatedArguments.size > 0) {
    errors.push(duplicateArgumentsError(originalFieldPath, [...duplicatedArguments]));
  }
  return argumentDataByArgumentName;
}

export function isTypeRequired(node: TypeNode): boolean {
  return node.kind === Kind.NON_NULL_TYPE;
}

// TODO replace naïve comparison
function areDefaultValuesCompatible(typeNode: TypeNode, incomingDefaultValue: ConstValueNode): boolean {
  switch (typeNode.kind) {
    case Kind.LIST_TYPE:
      return incomingDefaultValue.kind === Kind.LIST || incomingDefaultValue.kind === Kind.NULL;
    case Kind.NAMED_TYPE:
      if (incomingDefaultValue.kind === Kind.NULL) {
        return true;
      }
      switch (typeNode.name.value) {
        case BOOLEAN_SCALAR:
          return incomingDefaultValue.kind === Kind.BOOLEAN;
        case FLOAT_SCALAR:
          return incomingDefaultValue.kind === Kind.INT || incomingDefaultValue.kind === Kind.FLOAT;
        case INT_SCALAR:
          return incomingDefaultValue.kind === Kind.INT;
        case STRING_SCALAR:
          return incomingDefaultValue.kind === Kind.STRING;
        default:
          return true;
      }
    case Kind.NON_NULL_TYPE:
      if (incomingDefaultValue.kind === Kind.NULL) {
        return false;
      }
      return areDefaultValuesCompatible(typeNode.type, incomingDefaultValue);
  }
}

function compareAndValidateInputValueDefaultValues(
  existingData: InputValueData,
  incomingData: InputValueData,
  errors: Error[],
) {
  if (!existingData.defaultValue) {
    // TODO warning if default value in incoming
    return;
  }
  if (!incomingData.defaultValue) {
    // TODO warning
    existingData.includeDefaultValue = false;
    return;
  }
  const existingDefaultValueString = print(existingData.defaultValue);
  const incomingDefaultValueString = print(incomingData.defaultValue);
  if (existingDefaultValueString !== incomingDefaultValueString) {
    errors.push(
      incompatibleInputValueDefaultValuesError(
        `${existingData.isArgument ? 'argument' : 'input value'} "${existingData.name}"`,
        existingData.originalPath,
        [...incomingData.subgraphNames],
        existingDefaultValueString,
        incomingDefaultValueString,
      ),
    );
    return;
  }
}

export function addEnumDefinitionDataByNode(
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>,
  node: EnumTypeDefinitionNode,
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
) {
  const name = node.name.value;
  parentDefinitionDataByTypeName.set(name, {
    appearances: 1,
    directivesByDirectiveName,
    enumValueDataByValueName: new Map<string, EnumValueData>(),
    kind: node.kind,
    node: getMutableEnumNode(node),
    persistedDirectivesData: newPersistedDirectivesData(),
    name,
    description: formatDescription(node.description),
  });
}

export function addEnumExtensionDataByNode(
  parentExtensionDataByTypeName: Map<string, ParentExtensionData>,
  node: EnumTypeExtensionNode,
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
) {
  const name = node.name.value;
  parentExtensionDataByTypeName.set(name, {
    directivesByDirectiveName,
    enumValueDataByValueName: new Map<string, EnumValueData>(),
    kind: node.kind,
    name,
  });
}

export function addEnumValueDataByNode(
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
    persistedDirectivesData: newPersistedDirectivesData(),
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

export function addFieldDataByNode(
  fieldDataByFieldName: Map<string, FieldData>,
  node: FieldDefinitionNode,
  argumentDataByArgumentName: Map<string, InputValueData>,
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
  originalParentTypeName: string,
  renamedParentTypeName: string,
  subgraphName: string,
  isSubgraphVersionTwo: boolean,
  errors: Error[],
): FieldData {
  const name = node.name.value;
  const fieldPath = `${originalParentTypeName}.${name}`;
  const isNodeExternalOrShareableResult = isNodeExternalOrShareable(
    node,
    !isSubgraphVersionTwo,
    directivesByDirectiveName,
  );
  const fieldData: FieldData = {
    argumentDataByArgumentName: argumentDataByArgumentName,
    isExternalBySubgraphName: new Map<string, boolean>([[subgraphName, isNodeExternalOrShareableResult.isExternal]]),
    isInaccessible: directivesByDirectiveName.has(INACCESSIBLE),
    isShareableBySubgraphName: new Map<string, boolean>([[subgraphName, isNodeExternalOrShareableResult.isShareable]]),
    node: getMutableFieldNode(node, fieldPath, errors),
    name,
    namedTypeName: getTypeNodeNamedTypeName(node.type),
    originalParentTypeName,
    persistedDirectivesData: newPersistedDirectivesData(),
    renamedParentTypeName,
    subgraphNames: new Set<string>([subgraphName]),
    type: getMutableTypeNode(node.type, fieldPath, errors),
    directivesByDirectiveName,
    description: formatDescription(node.description),
  };
  fieldDataByFieldName.set(name, fieldData);
  return fieldData;
}

export function addExtensionWithFieldsDataByNode(
  parentExtensionDataByTypeName: Map<string, ParentExtensionData>,
  node: InterfaceTypeDefinitionNode | InterfaceTypeExtensionNode | ObjectTypeDefinitionNode | ObjectTypeExtensionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  isEntity: boolean,
  isRootType: boolean,
  subgraphName: string,
  renamedTypeName?: string,
) {
  const name = node.name.value;
  const kind = convertKindForExtension(node);
  switch (kind) {
    case Kind.INTERFACE_TYPE_EXTENSION:
      parentExtensionDataByTypeName.set(name, {
        directivesByDirectiveName: extractDirectives(
          node,
          new Map<string, ConstDirectiveNode[]>(),
          errors,
          directiveDefinitionByDirectiveName,
          handledRepeatedDirectivesByHostPath,
          name,
        ),
        fieldDataByFieldName: new Map<string, FieldData>(),
        implementedInterfaceTypeNames: extractImplementedInterfaceTypeNames(node, new Set<string>(), errors),
        isEntity,
        kind,
        name,
      });
      return;
    default:
      parentExtensionDataByTypeName.set(name, {
        directivesByDirectiveName: extractDirectives(
          node,
          new Map<string, ConstDirectiveNode[]>(),
          errors,
          directiveDefinitionByDirectiveName,
          handledRepeatedDirectivesByHostPath,
          name,
        ),
        fieldDataByFieldName: new Map<string, FieldData>(),
        implementedInterfaceTypeNames: extractImplementedInterfaceTypeNames(node, new Set<string>(), errors),
        isEntity,
        isRootType,
        kind,
        name,
        node: getMutableObjectExtensionNode(node as ObjectTypeExtensionNode),
        persistedDirectivesData: newPersistedDirectivesData(),
        renamedTypeName: renamedTypeName || name,
        subgraphNames: new Set<string>([subgraphName]),
      });
  }
}

export function addInputObjectDefinitionDataByNode(
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>,
  node: InputObjectTypeDefinitionNode,
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  subgraphName: string,
  errors: Error[],
) {
  const name = node.name.value;
  parentDefinitionDataByTypeName.set(name, {
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      name,
    ),
    inputValueDataByValueName: new Map<string, InputValueData>(),
    kind: node.kind,
    node: getMutableInputObjectNode(node),
    persistedDirectivesData: newPersistedDirectivesData(),
    name,
    subgraphNames: new Set<string>([subgraphName]),
    description: formatDescription(node.description),
  });
}

export function addInputObjectExtensionDataByNode(
  parentExtensionDataByTypeName: Map<string, ParentExtensionData>,
  node: InputObjectTypeExtensionNode,
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  errors: Error[],
) {
  const name = node.name.value;
  parentExtensionDataByTypeName.set(name, {
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      name,
    ),
    inputValueDataByValueName: new Map<string, InputValueData>(),
    kind: node.kind,
    name,
  });
}

export function addInputValueDataByNode(
  inputValueDataByValueName: Map<string, InputValueData>,
  node: InputValueDefinitionNode,
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  originalPath: string,
  subgraphName: string,
  errors: Error[],
  renamedPath?: string,
) {
  const name = node.name.value;
  // Only arguments have renamed paths
  const isArgument = !!renamedPath;
  if (node.defaultValue && !areDefaultValuesCompatible(node.type, node.defaultValue)) {
    errors.push(
      incompatibleInputValueDefaultValueTypeError(
        (isArgument ? 'argument' : 'input field') + ` "${name}"`,
        originalPath,
        printTypeNode(node.type),
        print(node.defaultValue),
      ),
    );
  }
  inputValueDataByValueName.set(name, {
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      originalPath,
      isArgument,
    ),
    includeDefaultValue: !!node.defaultValue,
    isArgument,
    name,
    node: getMutableInputValueNode(node, originalPath, errors),
    originalPath,
    persistedDirectivesData: newPersistedDirectivesData(),
    renamedPath: renamedPath || originalPath,
    requiredSubgraphNames: new Set<string>(isTypeRequired(node.type) ? [subgraphName] : []),
    subgraphNames: new Set<string>([subgraphName]),
    type: getMutableTypeNode(node.type, originalPath, errors),
    defaultValue: node.defaultValue, // TODO validate
    description: formatDescription(node.description),
  });
}

export function addInterfaceDefinitionDataByNode(
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>,
  node: InterfaceTypeDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  isEntity: boolean,
  subgraphName: string,
) {
  const name = node.name.value;
  parentDefinitionDataByTypeName.set(name, {
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      name,
    ),
    fieldDataByFieldName: new Map<string, FieldData>(),
    isEntity,
    implementedInterfaceTypeNames: extractImplementedInterfaceTypeNames(node, new Set<string>(), errors),
    kind: node.kind,
    node: getMutableInterfaceNode(node),
    persistedDirectivesData: newPersistedDirectivesData(),
    subgraphNames: new Set<string>([subgraphName]),
    name,
    description: formatDescription(node.description),
  });
}

export function addObjectDefinitionDataByNode(
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>,
  node: ObjectTypeDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  isEntity: boolean,
  isRootType: boolean,
  subgraphName: string,
  renamedTypeName?: string,
) {
  const name = node.name.value;
  parentDefinitionDataByTypeName.set(name, {
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      name,
    ),
    fieldDataByFieldName: new Map<string, FieldData>(),
    isEntity,
    isRootType,
    implementedInterfaceTypeNames: extractImplementedInterfaceTypeNames(node, new Set<string>(), errors),
    kind: node.kind,
    name,
    node: getMutableObjectNode(node),
    persistedDirectivesData: newPersistedDirectivesData(),
    renamedTypeName: renamedTypeName || name,
    subgraphNames: new Set<string>([subgraphName]),
    description: formatDescription(node.description),
  });
}

export function addPersistedDirectiveDefinitionDataByNode(
  persistedDirectiveDefinitionDataByDirectiveName: Map<string, PersistedDirectiveDefinitionData>,
  node: DirectiveDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  executableLocations: Set<string>,
  subgraphName: string,
) {
  const name = node.name.value;
  const argumentDataByArgumentName = new Map<string, InputValueData>();
  for (const argumentNode of node.arguments || []) {
    const originalPath = `@${name}(${argumentNode.name.value}: ...)`;
    addInputValueDataByNode(
      argumentDataByArgumentName,
      argumentNode,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      originalPath,
      subgraphName,
      errors,
      originalPath,
    );
  }
  persistedDirectiveDefinitionDataByDirectiveName.set(name, {
    argumentDataByArgumentName,
    executableLocations,
    name: name,
    repeatable: node.repeatable,
    subgraphNames: new Set<string>([subgraphName]),
    description: formatDescription(node.description),
  });
}

function setMutualExecutableLocations(
  persistedDirectiveDefinitionData: PersistedDirectiveDefinitionData,
  incomingExecutableLocations: Set<string>,
) {
  const mutualExecutableLocations = new Set<string>();
  for (const incomingExecutableLocation of incomingExecutableLocations) {
    if (persistedDirectiveDefinitionData.executableLocations.has(incomingExecutableLocation)) {
      mutualExecutableLocations.add(incomingExecutableLocation);
    }
  }
  persistedDirectiveDefinitionData.executableLocations = mutualExecutableLocations;
}

export function upsertPersistedDirectiveDefinitionData(
  persistedDirectiveDefinitionDataByDirectiveName: Map<string, PersistedDirectiveDefinitionData>,
  incomingData: PersistedDirectiveDefinitionData,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  namedInputValueTypeNames: Set<string>,
  subgraphNumber: number,
  errors: Error[],
) {
  const name = incomingData.name;
  const existingData = persistedDirectiveDefinitionDataByDirectiveName.get(name);
  if (!existingData) {
    // The executable directive must be defined in all subgraphs to be persisted.
    if (subgraphNumber > 1) {
      return;
    }
    const argumentDataByArgumentName = new Map<string, InputValueData>();
    for (const inputValueData of incomingData.argumentDataByArgumentName.values()) {
      namedInputValueTypeNames.add(getTypeNodeNamedTypeName(inputValueData.type));
      upsertInputValueData(
        argumentDataByArgumentName,
        inputValueData,
        persistedDirectiveDefinitionByDirectiveName,
        errors,
      );
    }
    persistedDirectiveDefinitionDataByDirectiveName.set(name, {
      argumentDataByArgumentName,
      executableLocations: new Set<string>(incomingData.executableLocations),
      name,
      repeatable: incomingData.repeatable,
      subgraphNames: new Set<string>(incomingData.subgraphNames),
      description: incomingData.description,
    });
    return;
  }
  // If the executable directive has not been defined in at least one graph, the definition should not be persisted
  if (existingData.subgraphNames.size + 1 !== subgraphNumber) {
    persistedDirectiveDefinitionDataByDirectiveName.delete(name);
    return;
  }
  setMutualExecutableLocations(existingData, incomingData.executableLocations);
  // If there are no mutually defined executable locations, the definition should not be persisted
  if (existingData.executableLocations.size < 1) {
    persistedDirectiveDefinitionDataByDirectiveName.delete(name);
    return;
  }
  for (const inputValueData of incomingData.argumentDataByArgumentName.values()) {
    namedInputValueTypeNames.add(getTypeNodeNamedTypeName(inputValueData.type));
    upsertInputValueData(
      existingData.argumentDataByArgumentName,
      inputValueData,
      persistedDirectiveDefinitionByDirectiveName,
      errors,
    );
  }
  setLongestDescription(existingData, incomingData);
  existingData.repeatable &&= incomingData.repeatable;
  addIterableValuesToSet(incomingData.subgraphNames, existingData.subgraphNames);
}

export function addScalarDefinitionDataByNode(
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>,
  node: ScalarTypeDefinitionNode,
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
) {
  const name = node.name.value;
  parentDefinitionDataByTypeName.set(name, {
    directivesByDirectiveName,
    kind: node.kind,
    node: getMutableScalarNode(node),
    persistedDirectivesData: newPersistedDirectivesData(),
    name,
    description: formatDescription(node.description),
  });
}

export function addScalarExtensionDataByNode(
  parentExtensionDataByTypeName: Map<string, ParentExtensionData>,
  node: ScalarTypeExtensionNode,
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
) {
  const name = node.name.value;
  parentExtensionDataByTypeName.set(name, {
    directivesByDirectiveName,
    kind: node.kind,
    name,
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

export function addUnionDefinitionDataByNode(
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>,
  node: UnionTypeDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  abstractToConcreteTypeNames: Map<string, Set<string>>,
  referencedTypeNames: Set<string>,
) {
  const name = node.name.value;
  if (!node.types?.length) {
    errors.push(noDefinedUnionMembersError(name));
    return;
  }
  parentDefinitionDataByTypeName.set(name, {
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      name,
    ),
    kind: node.kind,
    memberByMemberTypeName: extractUniqueUnionMembers(
      node.types,
      new Map<string, NamedTypeNode>(),
      errors,
      name,
      abstractToConcreteTypeNames,
      referencedTypeNames,
    ),
    node: getMutableUnionNode(node),
    persistedDirectivesData: newPersistedDirectivesData(),
    name,
    description: formatDescription(node.description),
  });
}

export function addUnionExtensionDataByNode(
  parentExtensionDataByTypeName: Map<string, ParentExtensionData>,
  node: UnionTypeExtensionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  abstractToConcreteTypeNames: Map<string, Set<string>>,
  referencedTypeNames: Set<string>,
) {
  const name = node.name.value;
  parentExtensionDataByTypeName.set(name, {
    directivesByDirectiveName: extractDirectives(
      node,
      new Map<string, ConstDirectiveNode[]>(),
      errors,
      directiveDefinitionByDirectiveName,
      handledRepeatedDirectivesByHostPath,
      name,
    ),
    kind: node.kind,
    memberByMemberTypeName: extractUniqueUnionMembers(
      // Undefined or empty node.types is handled earlier
      node.types!,
      new Map<string, NamedTypeNode>(),
      errors,
      name,
      abstractToConcreteTypeNames,
      referencedTypeNames,
    ),
    name,
  });
}

export function isTypeNameRootType(typeName: string, operationByTypeName: Map<string, OperationTypeNode>) {
  return ROOT_TYPES.has(typeName) || operationByTypeName.has(typeName);
}

export function getRenamedRootTypeName(typeName: string, operationByTypeName: Map<string, OperationTypeNode>): string {
  const operationTypeNode = operationByTypeName.get(typeName);
  if (!operationTypeNode) {
    return typeName;
  }
  switch (operationTypeNode) {
    case OperationTypeNode.MUTATION:
      return MUTATION;
    case OperationTypeNode.SUBSCRIPTION:
      return SUBSCRIPTION;
    default:
      return QUERY;
  }
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
  const authorizationData = authorizationDataByParentTypeName.get(fieldData.originalParentTypeName);
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
  const typeName = unionDefinitionData.name;
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
    enumDefinitionData.name,
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
    inputObjectDefinitionData.name,
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
    parentWithFieldsData.name,
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
    scalarDefinitionData.name,
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
    unionDefinitionData.name,
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

function setLongestDescription(existingData: DefinitionData, incomingData: DefinitionData) {
  if (!incomingData.description) {
    return;
  }
  if (!existingData.description || existingData.description.value.length < incomingData.description.value.length) {
    existingData.description = { ...incomingData.description, block: true };
  }
}

function upsertDeprecatedDirective(
  persistedDirectivesData: PersistedDirectivesData,
  incomingDirectiveNode: ConstDirectiveNode,
) {
  if (!incomingDirectiveNode.arguments?.length) {
    return;
  }
  // The argument was already validated in the normalization factory, so it can be safely cast
  const incomingReasonString = (incomingDirectiveNode.arguments[0].value as StringValueNode).value;
  if (persistedDirectivesData.deprecatedReason.length < incomingReasonString.length) {
    persistedDirectivesData.deprecatedReason = incomingReasonString;
  }
}

function upsertTagDirectives(
  persistedDirectivesData: PersistedDirectivesData,
  incomingDirectiveNodes: ConstDirectiveNode[],
) {
  for (const incomingDirectiveNode of incomingDirectiveNodes) {
    // The argument was already validated in the normalization factory, so it can be safely cast
    const incomingNameString = (incomingDirectiveNode.arguments![0].value as StringValueNode).value;
    persistedDirectivesData.tags.set(incomingNameString, incomingDirectiveNode);
  }
}

function extractPersistedDirectives(
  persistedDirectivesData: PersistedDirectivesData,
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
): PersistedDirectivesData {
  for (const [directiveName, directiveNodes] of directivesByDirectiveName) {
    if (!persistedDirectiveDefinitionByDirectiveName.has(directiveName)) {
      continue;
    }
    if (directiveName === DEPRECATED) {
      persistedDirectivesData.isDeprecated = true;
      upsertDeprecatedDirective(persistedDirectivesData, directiveNodes[0]);
      continue;
    }
    if (directiveName === TAG) {
      upsertTagDirectives(persistedDirectivesData, directiveNodes);
      continue;
    }
    const existingDirectives = persistedDirectivesData.directives.get(directiveName);
    if (!existingDirectives) {
      persistedDirectivesData.directives.set(directiveName, directiveNodes);
      continue;
    }
    existingDirectives.push(...directiveNodes);
  }
  return persistedDirectivesData;
}
function upsertEnumValueData(
  enumValueDataByValueName: Map<string, EnumValueData>,
  incomingData: EnumValueData,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
) {
  const existingData = enumValueDataByValueName.get(incomingData.name);
  extractPersistedDirectives(
    existingData?.persistedDirectivesData || incomingData.persistedDirectivesData,
    incomingData.directivesByDirectiveName,
    persistedDirectiveDefinitionByDirectiveName,
  );
  if (!existingData) {
    incomingData.node = {
      directives: [],
      kind: incomingData.node.kind,
      name: stringToNameNode(incomingData.name),
    };
    enumValueDataByValueName.set(incomingData.name, incomingData);
    return;
  }
  existingData.appearances += 1;
  setLongestDescription(existingData, incomingData);
}

function upsertFieldData(
  fieldDataByFieldName: Map<string, FieldData>,
  incomingData: FieldData,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  namedOutputTypeNames: Set<string>,
  namedInputValueTypeNames: Set<string>,
  errors: Error[],
) {
  namedOutputTypeNames.add(incomingData.namedTypeName);
  const existingData = fieldDataByFieldName.get(incomingData.name);
  extractPersistedDirectives(
    existingData?.persistedDirectivesData || incomingData.persistedDirectivesData,
    incomingData.directivesByDirectiveName,
    persistedDirectiveDefinitionByDirectiveName,
  );
  if (!existingData) {
    fieldDataByFieldName.set(incomingData.name, incomingData);
    incomingData.node = {
      arguments: [],
      directives: [],
      kind: incomingData.node.kind,
      name: stringToNameNode(incomingData.name),
      type: incomingData.type,
    };
    for (const inputValueData of incomingData.argumentDataByArgumentName.values()) {
      inputValueData.node = {
        directives: [],
        kind: inputValueData.node.kind,
        name: stringToNameNode(inputValueData.name),
        type: inputValueData.type,
      };
      namedInputValueTypeNames.add(getTypeNodeNamedTypeName(inputValueData.type));
      extractPersistedDirectives(
        inputValueData.persistedDirectivesData,
        inputValueData.directivesByDirectiveName,
        persistedDirectiveDefinitionByDirectiveName,
      );
    }
    return;
  }
  const fieldPath = `${existingData.renamedParentTypeName}.${existingData.name}`;
  const { typeErrors, typeNode } = getLeastRestrictiveMergedTypeNode(
    existingData.type,
    incomingData.type,
    fieldPath,
    errors,
  );
  if (typeNode) {
    existingData.type = typeNode;
  } else {
    if (!typeErrors || typeErrors.length < 2) {
      throw fieldTypeMergeFatalError(existingData.name);
    }
    errors.push(incompatibleChildTypesError(fieldPath, typeErrors[0], typeErrors[1]));
  }
  for (const inputValueData of incomingData.argumentDataByArgumentName.values()) {
    namedInputValueTypeNames.add(getTypeNodeNamedTypeName(inputValueData.type));
    upsertInputValueData(
      existingData.argumentDataByArgumentName,
      inputValueData,
      persistedDirectiveDefinitionByDirectiveName,
      errors,
    );
  }
  setLongestDescription(existingData, incomingData);
  existingData.isInaccessible ||= incomingData.isInaccessible;
  addMapEntries(incomingData.isExternalBySubgraphName, existingData.isExternalBySubgraphName);
  addMapEntries(incomingData.isShareableBySubgraphName, existingData.isShareableBySubgraphName);
  addIterableValuesToSet(incomingData.subgraphNames, existingData.subgraphNames);
}

function upsertInputValueData(
  inputValueDataByValueName: Map<string, InputValueData>,
  incomingData: InputValueData,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  errors: Error[],
) {
  const existingData = inputValueDataByValueName.get(incomingData.name);
  extractPersistedDirectives(
    existingData?.persistedDirectivesData || incomingData.persistedDirectivesData,
    incomingData.directivesByDirectiveName,
    persistedDirectiveDefinitionByDirectiveName,
  );
  if (!existingData) {
    incomingData.node = {
      directives: [],
      kind: incomingData.node.kind,
      name: stringToNameNode(incomingData.name),
      type: incomingData.type,
    };
    inputValueDataByValueName.set(incomingData.name, incomingData);
    return;
  }
  setLongestDescription(existingData, incomingData);
  addIterableValuesToSet(incomingData.requiredSubgraphNames, existingData.requiredSubgraphNames);
  addIterableValuesToSet(incomingData.subgraphNames, existingData.subgraphNames);
  // TODO refactor type merging
  const { typeErrors, typeNode } = getMostRestrictiveMergedTypeNode(
    existingData.type,
    incomingData.type,
    existingData.originalPath,
    errors,
  );
  if (typeNode) {
    existingData.type = typeNode;
  } else {
    if (!typeErrors || typeErrors.length < 2) {
      throw fieldTypeMergeFatalError(existingData.name);
    }
    existingData.isArgument
      ? errors.push(
          incompatibleArgumentTypesError(existingData.name, existingData.renamedPath, typeErrors[0], typeErrors[1]),
        )
      : errors.push(incompatibleChildTypesError(existingData.renamedPath, typeErrors[0], typeErrors[1]));
  }
  compareAndValidateInputValueDefaultValues(existingData, incomingData, errors);
}

export function upsertParentDefinitionData(
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>,
  incomingData: ParentDefinitionData,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  entityInterfaceFederationDataByTypeName: Map<string, EntityInterfaceFederationData>,
  namedOutputTypeNames: Set<string>,
  namedInputValueTypeNames: Set<string>,
  subgraphName: string,
  errors: Error[],
) {
  const entityInterfaceData = entityInterfaceFederationDataByTypeName.get(incomingData.name);
  const existingData = parentDefinitionDataByTypeName.get(incomingData.name);
  extractPersistedDirectives(
    existingData?.persistedDirectivesData || incomingData.persistedDirectivesData,
    incomingData.directivesByDirectiveName,
    persistedDirectiveDefinitionByDirectiveName,
  );
  if (!existingData) {
    if (entityInterfaceData && entityInterfaceData.interfaceObjectSubgraphs.has(subgraphName)) {
      incomingData.kind = Kind.INTERFACE_TYPE_DEFINITION;
    }
    incomingData.node = {
      kind: incomingData.kind,
      name: stringToNameNode(incomingData.name),
    };
    parentDefinitionDataByTypeName.set(incomingData.name, incomingData);
    switch (incomingData.kind) {
      case Kind.ENUM_TYPE_DEFINITION:
        for (const enumValueData of incomingData.enumValueDataByValueName.values()) {
          enumValueData.node = {
            directives: [],
            kind: enumValueData.node.kind,
            name: stringToNameNode(enumValueData.name),
          };
          extractPersistedDirectives(
            enumValueData.persistedDirectivesData,
            enumValueData.directivesByDirectiveName,
            persistedDirectiveDefinitionByDirectiveName,
          );
        }
        return;
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
        for (const inputValueData of incomingData.inputValueDataByValueName.values()) {
          inputValueData.node = {
            directives: [],
            kind: inputValueData.node.kind,
            name: stringToNameNode(inputValueData.name),
            type: inputValueData.type,
          };
          namedInputValueTypeNames.add(getTypeNodeNamedTypeName(inputValueData.type));
          extractPersistedDirectives(
            inputValueData.persistedDirectivesData,
            inputValueData.directivesByDirectiveName,
            persistedDirectiveDefinitionByDirectiveName,
          );
        }
        return;
      case Kind.INTERFACE_TYPE_DEFINITION:
      // intentional fallthrough
      case Kind.OBJECT_TYPE_DEFINITION:
        for (const fieldData of incomingData.fieldDataByFieldName.values()) {
          fieldData.node = {
            arguments: [],
            directives: [],
            kind: fieldData.node.kind,
            name: stringToNameNode(fieldData.name),
            type: fieldData.type,
          };
          namedOutputTypeNames.add(fieldData.namedTypeName);
          extractPersistedDirectives(
            fieldData.persistedDirectivesData,
            fieldData.directivesByDirectiveName,
            persistedDirectiveDefinitionByDirectiveName,
          );
          for (const inputValueData of fieldData.argumentDataByArgumentName.values()) {
            inputValueData.node = {
              directives: [],
              kind: inputValueData.node.kind,
              name: stringToNameNode(inputValueData.name),
              type: inputValueData.type,
            };
            namedInputValueTypeNames.add(getTypeNodeNamedTypeName(inputValueData.type));
            extractPersistedDirectives(
              inputValueData.persistedDirectivesData,
              inputValueData.directivesByDirectiveName,
              persistedDirectiveDefinitionByDirectiveName,
            );
          }
        }
        return;
      default:
        // Scalar and Union
        return;
    }
  }
  setLongestDescription(existingData, incomingData);
  if (existingData.kind !== incomingData.kind) {
    if (
      !entityInterfaceData ||
      !entityInterfaceData.interfaceObjectSubgraphs.has(subgraphName) ||
      existingData.kind !== Kind.INTERFACE_TYPE_DEFINITION ||
      incomingData.kind !== Kind.OBJECT_TYPE_DEFINITION
    ) {
      errors.push(
        incompatibleParentKindMergeError(
          existingData.name,
          kindToTypeString(existingData.kind),
          kindToTypeString(incomingData.kind),
        ),
      );
      return;
    }
  }
  switch (existingData.kind) {
    case Kind.ENUM_TYPE_DEFINITION:
      existingData.appearances += 1;
      for (const data of (incomingData as EnumDefinitionData).enumValueDataByValueName.values()) {
        upsertEnumValueData(existingData.enumValueDataByValueName, data, persistedDirectiveDefinitionByDirectiveName);
      }
      return;
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
      addIterableValuesToSet((incomingData as InputObjectDefinitionData).subgraphNames, existingData.subgraphNames);
      for (const inputValueData of (incomingData as InputObjectDefinitionData).inputValueDataByValueName.values()) {
        namedInputValueTypeNames.add(getTypeNodeNamedTypeName(inputValueData.type));
        upsertInputValueData(
          existingData.inputValueDataByValueName,
          inputValueData,
          persistedDirectiveDefinitionByDirectiveName,
          errors,
        );
      }
      return;
    case Kind.INTERFACE_TYPE_DEFINITION:
    // intentional fallthrough
    case Kind.OBJECT_TYPE_DEFINITION:
      const objectData = incomingData as DefinitionWithFieldsData;
      addIterableValuesToSet(objectData.implementedInterfaceTypeNames, existingData.implementedInterfaceTypeNames);
      addIterableValuesToSet(objectData.subgraphNames, existingData.subgraphNames);
      for (const fieldData of objectData.fieldDataByFieldName.values()) {
        upsertFieldData(
          existingData.fieldDataByFieldName,
          fieldData,
          persistedDirectiveDefinitionByDirectiveName,
          namedOutputTypeNames,
          namedInputValueTypeNames,
          errors,
        );
      }
      return;
    case Kind.UNION_TYPE_DEFINITION:
      addMapEntries((incomingData as UnionDefinitionData).memberByMemberTypeName, existingData.memberByMemberTypeName);
      return;
    default:
      // Scalar type
      return;
  }
}

export function upsertObjectExtensionData(
  parentExtensionDataByTypeName: Map<string, ObjectExtensionData>,
  incomingData: ObjectExtensionData,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  namedOutputTypeNames: Set<string>,
  namedInputValueTypeNames: Set<string>,
  errors: Error[],
) {
  const existingData = parentExtensionDataByTypeName.get(incomingData.name);
  extractPersistedDirectives(
    existingData?.persistedDirectivesData || incomingData.persistedDirectivesData,
    incomingData.directivesByDirectiveName,
    persistedDirectiveDefinitionByDirectiveName,
  );
  if (!existingData) {
    incomingData.node = {
      kind: incomingData.kind,
      name: stringToNameNode(incomingData.name),
    };
    for (const fieldData of incomingData.fieldDataByFieldName.values()) {
      fieldData.node = {
        arguments: [],
        directives: [],
        kind: fieldData.node.kind,
        name: stringToNameNode(fieldData.name),
        type: fieldData.type,
      };
      namedOutputTypeNames.add(fieldData.namedTypeName);
      extractPersistedDirectives(
        fieldData.persistedDirectivesData,
        fieldData.directivesByDirectiveName,
        persistedDirectiveDefinitionByDirectiveName,
      );
      for (const inputValueData of fieldData.argumentDataByArgumentName.values()) {
        inputValueData.node = {
          directives: [],
          kind: inputValueData.node.kind,
          name: stringToNameNode(inputValueData.name),
          type: inputValueData.type,
        };
        namedInputValueTypeNames.add(getTypeNodeNamedTypeName(inputValueData.type));
        extractPersistedDirectives(
          inputValueData.persistedDirectivesData,
          inputValueData.directivesByDirectiveName,
          persistedDirectiveDefinitionByDirectiveName,
        );
      }
    }
    parentExtensionDataByTypeName.set(incomingData.name, incomingData);
    return;
  }
  addIterableValuesToSet(incomingData.implementedInterfaceTypeNames, existingData.implementedInterfaceTypeNames);
  addIterableValuesToSet(incomingData.subgraphNames, existingData.subgraphNames);
  for (const fieldData of incomingData.fieldDataByFieldName.values()) {
    upsertFieldData(
      existingData.fieldDataByFieldName,
      fieldData,
      persistedDirectiveDefinitionByDirectiveName,
      namedOutputTypeNames,
      namedInputValueTypeNames,
      errors,
    );
  }
}

function upsertPersistedDirectivesData(existingData: PersistedDirectivesData, incomingData: PersistedDirectivesData) {
  if (incomingData.isDeprecated && existingData.deprecatedReason.length < incomingData.deprecatedReason.length) {
    existingData.isDeprecated = true;
    existingData.deprecatedReason = incomingData.deprecatedReason;
  }
  for (const [directiveName, directiveNodes] of incomingData.directives) {
    const existingDirectiveNodes = existingData.directives.get(directiveName);
    if (!existingDirectiveNodes) {
      existingData.directives.set(directiveName, directiveNodes);
      continue;
    }
    existingDirectiveNodes.push(...directiveNodes);
  }
  for (const [tagName, tagDirectiveNode] of incomingData.tags) {
    if (existingData.tags.has(tagName)) {
      continue;
    }
    existingData.tags.set(tagName, tagDirectiveNode);
  }
}

export function pushAuthorizationDirectives(fieldData: FieldData, authorizationData?: AuthorizationData) {
  if (!authorizationData) {
    return;
  }
  const fieldAuthorizationData = authorizationData.fieldAuthorizationDataByFieldName.get(fieldData.name);
  if (!fieldAuthorizationData) {
    return;
  }
  if (fieldAuthorizationData.requiresAuthentication) {
    fieldData.persistedDirectivesData.directives.set(AUTHENTICATED, [generateSimpleDirective(AUTHENTICATED)]);
  }
  if (fieldAuthorizationData.requiredScopes.length > 0) {
    fieldData.persistedDirectivesData.directives.set(REQUIRES_SCOPES, [
      generateRequiresScopesDirective(fieldAuthorizationData.requiredScopes),
    ]);
  }
}

export function upsertValidObjectExtensionData(
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>,
  incomingData: ObjectExtensionData,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  namedOutputTypeNames: Set<string>,
  namedInputValueTypeNames: Set<string>,
  errors: Error[],
  authorizationData?: AuthorizationData,
) {
  const existingData = parentDefinitionDataByTypeName.get(incomingData.name);
  if (!existingData) {
    if (incomingData.isRootType) {
      for (const fieldData of incomingData.fieldDataByFieldName.values()) {
        pushAuthorizationDirectives(fieldData, authorizationData);
      }
      parentDefinitionDataByTypeName.set(incomingData.name, {
        directivesByDirectiveName: incomingData.directivesByDirectiveName,
        fieldDataByFieldName: incomingData.fieldDataByFieldName,
        implementedInterfaceTypeNames: incomingData.implementedInterfaceTypeNames,
        isRootType: true,
        isEntity: false,
        kind: Kind.OBJECT_TYPE_DEFINITION,
        name: incomingData.name,
        node: {
          kind: Kind.OBJECT_TYPE_DEFINITION,
          name: stringToNameNode(incomingData.name),
        },
        persistedDirectivesData: incomingData.persistedDirectivesData,
        renamedTypeName: incomingData.renamedTypeName,
        subgraphNames: incomingData.subgraphNames,
      });
      return;
    }
    errors.push(noBaseTypeExtensionError(incomingData.name));
    return;
  }
  if (existingData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
    errors.push(incompatibleObjectExtensionOrphanBaseTypeError(existingData.name, kindToTypeString(existingData.kind)));
    return;
  }
  upsertPersistedDirectivesData(existingData.persistedDirectivesData, incomingData.persistedDirectivesData);
  addIterableValuesToSet(incomingData.implementedInterfaceTypeNames, existingData.implementedInterfaceTypeNames);
  for (const fieldData of incomingData.fieldDataByFieldName.values()) {
    upsertFieldData(
      existingData.fieldDataByFieldName,
      fieldData,
      persistedDirectiveDefinitionByDirectiveName,
      namedOutputTypeNames,
      namedInputValueTypeNames,
      errors,
    );
  }
}

function generateDeprecatedDirective(reason: string): ConstDirectiveNode {
  return {
    kind: Kind.DIRECTIVE,
    name: stringToNameNode(DEPRECATED),
    arguments: [
      {
        kind: Kind.ARGUMENT,
        name: stringToNameNode(REASON),
        value: {
          kind: Kind.STRING,
          value: reason || DEPRECATED_DEFAULT_ARGUMENT_VALUE, // use the default value if reason is empty
        },
      },
    ],
  };
}

function getValidFlattenedPersistedDirectiveNodeArray(
  directivesByDirectiveName: Map<string, ConstDirectiveNode[]>,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  hostPath: string,
  errors: Error[],
): ConstDirectiveNode[] {
  const persistedDirectiveNodes: ConstDirectiveNode[] = [];
  for (const [directiveName, directiveNodes] of directivesByDirectiveName) {
    const persistedDirectiveDefinition = persistedDirectiveDefinitionByDirectiveName.get(directiveName);
    if (!persistedDirectiveDefinition) {
      continue;
    }
    if (directiveNodes.length < 2) {
      persistedDirectiveNodes.push(...directiveNodes);
      continue;
    }
    if (!persistedDirectiveDefinition.repeatable) {
      errors.push(invalidRepeatedFederatedDirectiveErrorMessage(directiveName, hostPath));
      continue;
    }
    persistedDirectiveNodes.push(...directiveNodes);
  }
  return persistedDirectiveNodes;
}

function getPersistedDirectiveNodes<T extends NodeData>(
  nodeData: T,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  errors: Error[],
): ConstDirectiveNode[] {
  const persistedDirectiveNodes = [...nodeData.persistedDirectivesData.tags.values()];
  if (nodeData.persistedDirectivesData.isDeprecated) {
    persistedDirectiveNodes.push(generateDeprecatedDirective(nodeData.persistedDirectivesData.deprecatedReason));
  }
  persistedDirectiveNodes.push(
    ...getValidFlattenedPersistedDirectiveNodeArray(
      nodeData.persistedDirectivesData.directives,
      persistedDirectiveDefinitionByDirectiveName,
      nodeData.name,
      errors,
    ),
  );
  return persistedDirectiveNodes;
}

export function getNodeWithPersistedDirectivesByData<T extends ParentDefinitionData | EnumValueData>(
  data: T,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  errors: Error[],
): T['node'] {
  data.node.name = stringToNameNode(data.name);
  data.node.description = data.description;
  data.node.directives = getPersistedDirectiveNodes(data, persistedDirectiveDefinitionByDirectiveName, errors);
  return data.node;
}

export function getNodeWithPersistedDirectivesByFieldData(
  fieldData: FieldData,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  argumentNodes: MutableInputValueNode[],
  errors: Error[],
): MutableFieldNode {
  fieldData.node.arguments = argumentNodes;
  fieldData.node.name = stringToNameNode(fieldData.name);
  fieldData.node.type = fieldData.type;
  fieldData.node.description = fieldData.description;
  fieldData.node.directives = getPersistedDirectiveNodes(
    fieldData,
    persistedDirectiveDefinitionByDirectiveName,
    errors,
  );
  return fieldData.node;
}

export function getNodeWithPersistedDirectivesByInputValueData(
  inputValueData: InputValueData,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  errors: Error[],
): MutableInputValueNode {
  inputValueData.node.name = stringToNameNode(inputValueData.name);
  inputValueData.node.type = inputValueData.type;
  inputValueData.node.description = inputValueData.description;
  inputValueData.node.directives = getPersistedDirectiveNodes(
    inputValueData,
    persistedDirectiveDefinitionByDirectiveName,
    errors,
  );
  if (inputValueData.includeDefaultValue) {
    inputValueData.node.defaultValue = inputValueData.defaultValue;
  }
  return inputValueData.node;
}

export function getValidFieldArgumentNodes(
  fieldData: FieldData,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  fieldConfigurationByFieldPath: Map<string, FieldConfiguration>,
  errors: Error[],
): MutableInputValueNode[] {
  const argumentNodes: MutableInputValueNode[] = [];
  const argumentNames: string[] = [];
  const invalidRequiredArguments: InvalidRequiredInputValueData[] = [];
  const fieldPath = `${fieldData.renamedParentTypeName}.${fieldData.name}`;
  for (const [argumentName, inputValueData] of fieldData.argumentDataByArgumentName) {
    if (fieldData.subgraphNames.size === inputValueData.subgraphNames.size) {
      argumentNames.push(argumentName);
      argumentNodes.push(
        getNodeWithPersistedDirectivesByInputValueData(
          inputValueData,
          persistedDirectiveDefinitionByDirectiveName,
          errors,
        ),
      );
    } else if (isTypeRequired(inputValueData.type)) {
      invalidRequiredArguments.push({
        inputValueName: argumentName,
        missingSubgraphs: getEntriesNotInHashSet(fieldData.subgraphNames, inputValueData.subgraphNames),
        requiredSubgraphs: [...inputValueData.requiredSubgraphNames],
      });
    }
  }
  if (invalidRequiredArguments.length > 0) {
    errors.push(invalidRequiredInputValueError(FIELD, fieldPath, invalidRequiredArguments));
  } else if (argumentNames.length > 0) {
    fieldConfigurationByFieldPath.set(fieldPath, {
      argumentNames,
      fieldName: fieldData.name,
      typeName: fieldData.renamedParentTypeName,
    });
  }
  return argumentNodes;
}
function addValidatedArgumentNodes(
  argumentNodes: MutableInputValueNode[],
  hostData: PersistedDirectiveDefinitionData,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  errors: Error[],
  argumentNamesForFieldConfiguration?: Set<string>,
): boolean {
  const invalidRequiredArgumentErrors: InvalidRequiredInputValueData[] = [];
  for (const [argumentName, argumentData] of hostData.argumentDataByArgumentName) {
    const missingSubgraphs = getEntriesNotInHashSet(hostData.subgraphNames, argumentData.subgraphNames);
    if (missingSubgraphs.length > 0) {
      // Required arguments must be defined in all subgraphs that define the field
      if (argumentData.requiredSubgraphNames.size > 0) {
        invalidRequiredArgumentErrors.push({
          inputValueName: argumentName,
          missingSubgraphs,
          requiredSubgraphs: [...argumentData.requiredSubgraphNames],
        });
      }
      /* If the argument is always optional, but it's not defined in all subgraphs that define the field,
         the argument should not be included in the federated graph */
      continue;
    }
    argumentNodes.push(
      getNodeWithPersistedDirectivesByInputValueData(argumentData, persistedDirectiveDefinitionByDirectiveName, errors),
    );
    if (argumentNamesForFieldConfiguration) {
      argumentNamesForFieldConfiguration.add(argumentName);
    }
  }
  if (invalidRequiredArgumentErrors.length > 0) {
    errors.push(
      invalidRequiredInputValueError(DIRECTIVE_DEFINITION, `@${hostData.name}`, invalidRequiredArgumentErrors),
    );
    return false;
  }
  return true;
}

export function addValidPersistedDirectiveDefinitionNodeByData(
  definitions: MutableTypeDefinitionNode[],
  data: PersistedDirectiveDefinitionData,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  errors: Error[],
) {
  const argumentNodes: MutableInputValueNode[] = [];
  if (!addValidatedArgumentNodes(argumentNodes, data, persistedDirectiveDefinitionByDirectiveName, errors)) {
    return;
  }
  definitions.push({
    arguments: argumentNodes,
    kind: Kind.DIRECTIVE_DEFINITION,
    locations: setToNameNodeArray(data.executableLocations),
    name: stringToNameNode(data.name),
    repeatable: data.repeatable,
    description: data.description,
  });
}

export function isShareabilityOfAllFieldInstancesValid(fieldData: FieldData): boolean {
  let shareableFields = 0;
  let unshareableFields = 0;
  for (const [subgraphName, isShareable] of fieldData.isShareableBySubgraphName) {
    /*
      shareability is ignored if:
      1. the field is external
      2. the field is overridden by another subgraph (in which case it has not been upserted)
    */
    if (fieldData.isExternalBySubgraphName.get(subgraphName)) {
      continue;
    }
    if (isShareable) {
      if (unshareableFields) {
        return false;
      }
      shareableFields += 1;
      continue;
    }
    unshareableFields += 1;
    if (shareableFields || unshareableFields > 1) {
      return false;
    }
  }
  return true;
}

export function isFieldExternalInAllMutualSubgraphs(subgraphs: Set<string>, fieldData: FieldData): boolean {
  const mutualSubgraphs = getAllMutualEntries(subgraphs, fieldData.subgraphNames);
  if (mutualSubgraphs.size < 1) {
    return false;
  }
  for (const mutualSubgraph of mutualSubgraphs) {
    const isExternal = fieldData.isExternalBySubgraphName.get(mutualSubgraph);
    if (isExternal) {
      continue;
    }
    return false;
  }
  return true;
}

export enum MergeMethod {
  UNION,
  INTERSECTION,
  CONSISTENT,
}

export function isTypeValidImplementation(
  originalType: TypeNode,
  implementationType: TypeNode,
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>,
): boolean {
  if (originalType.kind === Kind.NON_NULL_TYPE) {
    if (implementationType.kind !== Kind.NON_NULL_TYPE) {
      return false;
    }
    return isTypeValidImplementation(originalType.type, implementationType.type, concreteTypeNamesByAbstractTypeName);
  }
  if (implementationType.kind === Kind.NON_NULL_TYPE) {
    return isTypeValidImplementation(originalType, implementationType.type, concreteTypeNamesByAbstractTypeName);
  }
  switch (originalType.kind) {
    case Kind.NAMED_TYPE:
      if (implementationType.kind === Kind.NAMED_TYPE) {
        const originalTypeName = originalType.name.value;
        const implementationTypeName = implementationType.name.value;
        if (originalTypeName === implementationTypeName) {
          return true;
        }
        const concreteTypes = concreteTypeNamesByAbstractTypeName.get(originalTypeName);
        if (!concreteTypes) {
          return false;
        }
        return concreteTypes.has(implementationTypeName);
      }
      return false;
    default:
      if (implementationType.kind === Kind.LIST_TYPE) {
        return isTypeValidImplementation(
          originalType.type,
          implementationType.type,
          concreteTypeNamesByAbstractTypeName,
        );
      }
      return false;
  }
}
