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
  IntValueNode,
  Kind,
  NullValueNode,
  OperationTypeNode,
  print,
  StringValueNode,
  TypeNode,
} from 'graphql';
import {
  AuthorizationData,
  ChildData,
  CompositeOutputData,
  ConditionalFieldData,
  DefinitionData,
  EnumDefinitionData,
  EnumValueData,
  ExtensionType,
  ExternalFieldData,
  FieldData,
  InputValueData,
  NodeData,
  ParentDefinitionData,
  PersistedDirectiveDefinitionData,
  PersistedDirectivesData,
  ScalarDefinitionData,
} from './types';
import { MutableFieldNode, MutableInputValueNode, MutableTypeDefinitionNode } from './ast';
import { ObjectTypeNode, setToNameNodeArray, stringToNameNode } from '../ast/utils';
import {
  incompatibleInputValueDefaultValuesError,
  invalidRepeatedFederatedDirectiveErrorMessage,
  invalidRequiredInputValueError,
} from '../errors/errors';
import { FieldConfiguration, SubscriptionFilterValue } from '../router-configuration/types';
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
  INHERITABLE_DIRECTIVE_NAMES,
  INPUT_FIELD,
  INT_SCALAR,
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
import {
  generateRequiresScopesDirective,
  generateSimpleDirective,
  getEntriesNotInHashSet,
  getValueOrDefault,
} from '../utils/utils';
import { InvalidRequiredInputValueData } from '../utils/types';

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

export function isTypeRequired(node: TypeNode): boolean {
  return node.kind === Kind.NON_NULL_TYPE;
}

// TODO replace naïve comparison
export function areDefaultValuesCompatible(typeNode: TypeNode, incomingDefaultValue: ConstValueNode): boolean {
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

export function childMapToValueArray<V extends ChildData, N extends ChildDefinitionNode = V['node']>(
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

export function removeInheritableDirectivesFromObjectParent(parentData: ParentDefinitionData) {
  if (parentData.kind !== Kind.OBJECT_TYPE_DEFINITION) {
    return;
  }
  for (const directiveName of INHERITABLE_DIRECTIVE_NAMES) {
    parentData.directivesByDirectiveName.delete(directiveName);
  }
}

export function removeIgnoredDirectives(data: CompositeOutputData | EnumDefinitionData | ScalarDefinitionData) {
  for (const directiveName of IGNORED_PARENT_DIRECTIVES) {
    data.directivesByDirectiveName.delete(directiveName);
  }
}

export function setLongestDescription(existingData: DefinitionData, incomingData: DefinitionData) {
  if (!incomingData.description) {
    return;
  }
  if ('configureDescriptionDataBySubgraphName' in incomingData) {
    // There should be only be an incoming value for a single subgraph
    for (const { propagate } of incomingData.configureDescriptionDataBySubgraphName.values()) {
      if (!propagate) {
        return;
      }
    }
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
  return parentData.kind === Kind.INTERFACE_TYPE_DEFINITION;
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

export function generateDeprecatedDirective(reason: string): ConstDirectiveNode {
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
  directiveCoords: string,
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
      errors.push(invalidRepeatedFederatedDirectiveErrorMessage(directiveName, directiveCoords));
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
    const externalFieldData = fieldData.externalFieldDataBySubgraphName.get(subgraphName);
    if (externalFieldData && !externalFieldData.isUnconditionallyProvided) {
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
    return parentData.renamedTypeName || parentData.name;
  }
  return parentData.name;
}

export function newConditionalFieldData(): ConditionalFieldData {
  return {
    providedBy: [],
    requiredBy: [],
  };
}

export function getDefinitionDataCoords(data: NodeData, useRenamedPath: boolean): string {
  switch (data.kind) {
    case Kind.ENUM_VALUE_DEFINITION: {
      return `${data.parentTypeName}.${data.name}`;
    }
    case Kind.FIELD_DEFINITION: {
      return `${useRenamedPath ? data.renamedParentTypeName : data.originalParentTypeName}.${data.name}`;
    }
    case Kind.ARGUMENT:
    // intentional fallthrough
    case Kind.INPUT_VALUE_DEFINITION: {
      return useRenamedPath ? data.renamedPath : data.originalPath;
    }
    case Kind.OBJECT_TYPE_DEFINITION: {
      return useRenamedPath ? data.renamedTypeName : data.name;
    }
    default:
      return data.name;
  }
}

export function newExternalFieldData(isDefinedExternal: boolean): ExternalFieldData {
  return {
    isDefinedExternal,
    isUnconditionallyProvided: !isDefinedExternal,
  };
}
