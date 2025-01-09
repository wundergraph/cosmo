import {
  BooleanValueNode,
  ConstDirectiveNode,
  ConstValueNode,
  DirectiveDefinitionNode,
  EnumValueDefinitionNode,
  EnumValueNode,
  FieldDefinitionNode,
  FloatValueNode,
  InputValueDefinitionNode,
  InterfaceTypeDefinitionNode,
  IntValueNode,
  Kind,
  NullValueNode,
  ObjectTypeDefinitionNode,
  ObjectTypeExtensionNode,
  OperationTypeNode,
  print,
  SchemaDefinitionNode,
  StringValueNode,
  TypeNode,
} from 'graphql';
import {
  ChildData,
  CompositeOutputData,
  DefinitionData,
  EnumDefinitionData,
  EnumValueData,
  ExtensionType,
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
  getMutableEnumValueNode,
  getMutableFieldNode,
  getMutableInputValueNode,
  getMutableTypeNode,
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
  incompatibleInputValueDefaultValuesError,
  incompatibleInputValueDefaultValueTypeError,
  invalidDirectiveError,
  invalidDirectiveLocationErrorMessage,
  invalidKeyDirectiveArgumentErrorMessage,
  invalidRepeatedDirectiveErrorMessage,
  invalidRepeatedFederatedDirectiveErrorMessage,
  invalidRequiredInputValueError,
  undefinedDirectiveErrorMessage,
  undefinedRequiredArgumentsErrorMessage,
  unexpectedDirectiveArgumentErrorMessage,
  unexpectedDirectiveArgumentsErrorMessage,
} from '../errors/errors';
import {
  ARGUMENT,
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
  INPUT_FIELD,
  INT_SCALAR,
  KEY,
  MUTATION,
  PERSISTED_CLIENT_DIRECTIVES,
  QUERY,
  REASON,
  REQUIRES_SCOPES,
  ROOT_TYPE_NAMES,
  SHAREABLE,
  STRING_SCALAR,
  SUBSCRIPTION,
  TAG,
} from '../utils/string-constants';
import { areNodeKindAndDirectiveLocationCompatible, getDirectiveDefinitionArgumentSets } from '../normalization/utils';
import {
  AuthorizationData,
  generateRequiresScopesDirective,
  generateSimpleDirective,
  getEntriesNotInHashSet,
  getValueOrDefault,
  InvalidRequiredInputValueData,
  mapToArrayOfValues,
} from '../utils/utils';
import { INHERITABLE_DIRECTIVE_NAMES, V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME } from '../utils/constants';
import {
  FieldConfiguration,
  FieldSetCondition,
  SubscriptionFilterValue,
} from '../router-configuration/router-configuration';
import { printTypeNode } from '@graphql-tools/merge';

export function newPersistedDirectivesData(): PersistedDirectivesData {
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
    const handledRepeatedDirectives = getValueOrDefault(
      handledRepeatedDirectivesByHostPath,
      hostPath,
      () => new Set<string>(),
    );
    // If the directive name exists as a value on the host path key, the repeatable error has been handled
    if (!handledRepeatedDirectives.has(directiveName)) {
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

export function compareAndValidateInputValueDefaultValues(
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
        `${existingData.isArgument ? ARGUMENT : INPUT_FIELD} "${existingData.name}"`,
        existingData.originalPath,
        [...incomingData.subgraphNames],
        existingDefaultValueString,
        incomingDefaultValueString,
      ),
    );
    return;
  }
}

export function addEnumValueDataByNode(
  enumValueDataByValueName: Map<string, EnumValueData>,
  node: EnumValueDefinitionNode,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  handledRepeatedDirectivesByHostPath: Map<string, Set<string>>,
  parentTypeName: string,
  subgraphName: string,
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
    subgraphNames: new Set([subgraphName]),
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
        (isArgument ? ARGUMENT : INPUT_FIELD) + ` "${name}"`,
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

export function setMutualExecutableLocations(
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

export function isTypeNameRootType(typeName: string, operationByTypeName: Map<string, OperationTypeNode>) {
  return ROOT_TYPE_NAMES.has(typeName) || operationByTypeName.has(typeName);
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

export function getEnumNodeByData(
  enumDefinitionData: EnumDefinitionData,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  authorizationDataByParentTypeName: Map<string, AuthorizationData>,
) {
  enumDefinitionData.node.description = enumDefinitionData.description;
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
) {
  inputObjectDefinitionData.node.description = inputObjectDefinitionData.description;
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

export function getCompositeOutputNodeByData(
  compositeOutputData: CompositeOutputData,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  authorizationDataByParentTypeName: Map<string, AuthorizationData>,
): ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode | ObjectTypeExtensionNode {
  compositeOutputData.node.description = compositeOutputData.description;
  compositeOutputData.node.directives = getValidFlattenedDirectiveArray(
    compositeOutputData.directivesByDirectiveName,
    errors,
    directiveDefinitionByDirectiveName,
    compositeOutputData.name,
  );
  compositeOutputData.node.fields = childMapToValueArray(
    compositeOutputData.fieldDataByFieldName,
    authorizationDataByParentTypeName,
  );
  compositeOutputData.node.interfaces = setToNamedTypeNodeArray(compositeOutputData.implementedInterfaceTypeNames);
  return compositeOutputData.node;
}

export function getScalarNodeByData(
  scalarDefinitionData: ScalarDefinitionData,
  errors: Error[],
  directiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
) {
  scalarDefinitionData.node.description = scalarDefinitionData.description;
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
) {
  unionDefinitionData.node.description = unionDefinitionData.description;
  unionDefinitionData.node.directives = getValidFlattenedDirectiveArray(
    unionDefinitionData.directivesByDirectiveName,
    errors,
    directiveDefinitionByDirectiveName,
    unionDefinitionData.name,
  );
  unionDefinitionData.node.types = mapToArrayOfValues(unionDefinitionData.memberByMemberTypeName);
  return unionDefinitionData.node;
}

export function removeInheritableDirectivesFromParentWithFieldsData(parentData: ParentDefinitionData) {
  for (const directiveName of INHERITABLE_DIRECTIVE_NAMES) {
    parentData.directivesByDirectiveName.delete(directiveName);
  }
}

export function setLongestDescription(existingData: DefinitionData, incomingData: DefinitionData) {
  if (!incomingData.description) {
    return;
  }
  if (!existingData.description || existingData.description.value.length < incomingData.description.value.length) {
    existingData.description = { ...incomingData.description, block: true };
  }
}

export function isParentDataRootType(parentData: ParentDefinitionData): boolean {
  if (parentData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
    return false;
  }
  return parentData.isRootType;
}

export function isParentDataInterfaceType(parentData: ParentDefinitionData): boolean {
  if (parentData.kind === Kind.INTERFACE_TYPE_DEFINITION) {
    return true;
  }
  return false;
}

export function setParentDataExtensionType(existingData: ParentDefinitionData, incomingData: ParentDefinitionData) {
  if (existingData.extensionType === incomingData.extensionType || existingData.extensionType === ExtensionType.NONE) {
    return;
  }
  if (incomingData.extensionType !== ExtensionType.NONE && !isParentDataRootType(incomingData)) {
    return;
  }
  // Root types do not create errors even if all are instances are extensions.
  existingData.extensionType = ExtensionType.NONE;
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

export function extractPersistedDirectives(
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
    // Only add one instance of the @inaccessible directive
    if (directiveName === INACCESSIBLE) {
      continue;
    }
    existingDirectives.push(...directiveNodes);
  }
  return persistedDirectivesData;
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

function getRouterPersistedDirectiveNodes<T extends NodeData>(
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

export function getClientPersistedDirectiveNodes<T extends NodeData>(nodeData: T): ConstDirectiveNode[] {
  const persistedDirectiveNodes: ConstDirectiveNode[] = [];
  if (nodeData.persistedDirectivesData.isDeprecated) {
    persistedDirectiveNodes.push(generateDeprecatedDirective(nodeData.persistedDirectivesData.deprecatedReason));
  }
  for (const [directiveName, directiveNodes] of nodeData.persistedDirectivesData.directives) {
    // Only include @deprecated, @authenticated, and @requiresScopes in the client schema
    if (!PERSISTED_CLIENT_DIRECTIVES.has(directiveName)) {
      continue;
    }
    /* Persisted client-facing directives or all non-repeatable.
     ** The directive is validated against the definition when creating the router schema node, so it is not necessary
     ** to validate again. */
    persistedDirectiveNodes.push(directiveNodes[0]);
  }
  return persistedDirectiveNodes;
}

export function getNodeForRouterSchemaByData<T extends ParentDefinitionData | EnumValueData>(
  data: T,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  errors: Error[],
): T['node'] {
  data.node.name = stringToNameNode(data.name);
  data.node.description = data.description;
  data.node.directives = getRouterPersistedDirectiveNodes(data, persistedDirectiveDefinitionByDirectiveName, errors);
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
  fieldData.node.directives = getRouterPersistedDirectiveNodes(
    fieldData,
    persistedDirectiveDefinitionByDirectiveName,
    errors,
  );
  return fieldData.node;
}

export function getClientSchemaFieldNodeByFieldData(fieldData: FieldData): MutableFieldNode {
  const directives = getClientPersistedDirectiveNodes(fieldData);
  const argumentNodes: MutableInputValueNode[] = [];
  for (const inputValueData of fieldData.argumentDataByArgumentName.values()) {
    if (isNodeDataInaccessible(inputValueData)) {
      continue;
    }
    argumentNodes.push({
      ...inputValueData.node,
      directives: getClientPersistedDirectiveNodes(inputValueData),
    });
  }
  return {
    ...fieldData.node,
    directives,
    arguments: argumentNodes,
  };
}

export function getNodeWithPersistedDirectivesByInputValueData(
  inputValueData: InputValueData,
  persistedDirectiveDefinitionByDirectiveName: Map<string, DirectiveDefinitionNode>,
  errors: Error[],
): MutableInputValueNode {
  inputValueData.node.name = stringToNameNode(inputValueData.name);
  inputValueData.node.type = inputValueData.type;
  inputValueData.node.description = inputValueData.description;
  inputValueData.node.directives = getRouterPersistedDirectiveNodes(
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
    // fieldConfiguration might already exist through subscriptionFilter
    getValueOrDefault(fieldConfigurationByFieldPath, fieldPath, () => ({
      argumentNames,
      fieldName: fieldData.name,
      typeName: fieldData.renamedParentTypeName,
    })).argumentNames = argumentNames;
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

type InvalidFieldNames = {
  byShareable: Set<string>;
  subgraphNamesByExternalFieldName: Map<string, Array<string>>;
};

export function newInvalidFieldNames() {
  return {
    byShareable: new Set<string>(),
    subgraphNamesByExternalFieldName: new Map<string, Array<string>>(),
  };
}

export function validateExternalAndShareable(fieldData: FieldData, invalidFieldNames: InvalidFieldNames) {
  // fieldData.subgraphNames.size is not used due to overridden fields
  const instances = fieldData.isShareableBySubgraphName.size;
  let externalFieldSubgraphNames: Array<string> = [];
  let unshareableFields = 0;
  for (const [subgraphName, isShareable] of fieldData.isShareableBySubgraphName) {
    /*
     * shareability is ignored if:
     * 1. the field is external
     * 2. the field is overridden by another subgraph (in which case it has not been upserted)
     */
    if (fieldData.isExternalBySubgraphName.get(subgraphName)) {
      externalFieldSubgraphNames.push(subgraphName);
      continue;
    }
    if (isShareable) {
      continue;
    }
    unshareableFields += 1;
  }
  switch (unshareableFields) {
    case 0:
      // At least one instance of a field must be non-external
      if (instances === externalFieldSubgraphNames.length) {
        invalidFieldNames.subgraphNamesByExternalFieldName.set(fieldData.name, externalFieldSubgraphNames);
      }
      return;
    case 1:
      // The field can be unshareable if it's the only one
      if (instances === 1) {
        return;
      }
      if (instances - externalFieldSubgraphNames.length !== 1) {
        invalidFieldNames.byShareable.add(fieldData.name);
      }
      return;
    default:
      invalidFieldNames.byShareable.add(fieldData.name);
  }
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

export function isNodeDataInaccessible(data: NodeData): boolean {
  return data.persistedDirectivesData.directives.has(INACCESSIBLE) || data.directivesByDirectiveName.has(INACCESSIBLE);
}

export function isLeafKind(kind: Kind): boolean {
  return kind === Kind.SCALAR_TYPE_DEFINITION || kind === Kind.ENUM_TYPE_DEFINITION;
}

export function getSubscriptionFilterValue(
  valueNode: BooleanValueNode | EnumValueNode | FloatValueNode | IntValueNode | NullValueNode | StringValueNode,
): SubscriptionFilterValue {
  switch (valueNode.kind) {
    case Kind.BOOLEAN: {
      return valueNode.value;
    }
    case Kind.ENUM:
    // intentional fallthrough
    case Kind.STRING: {
      return valueNode.value;
    }
    case Kind.FLOAT:
    // intentional fallthrough
    case Kind.INT: {
      // The incoming value should never not be a number but wrap in a catch just in case
      try {
        return parseFloat(valueNode.value);
      } catch {
        return 'NaN';
      }
    }
    case Kind.NULL: {
      return null;
    }
  }
}

export function getParentTypeName(parentData: CompositeOutputData): string {
  if (parentData.kind === Kind.OBJECT_TYPE_DEFINITION) {
    return parentData.renamedTypeName;
  }
  return parentData.name;
}

export enum FieldSetDirective {
  PROVIDES = 'provides',
  REQUIRES = 'requires',
}

export type ConditionalFieldData = {
  providedBy: Array<FieldSetCondition>;
  requiredBy: Array<FieldSetCondition>;
};

export function newConditionalFieldData(): ConditionalFieldData {
  return {
    providedBy: [],
    requiredBy: [],
  };
}
