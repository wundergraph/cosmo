import {
  BooleanValueNode,
  ConstDirectiveNode,
  ConstValueNode,
  DefinitionNode,
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
  EnumValueData,
  ExtensionType,
  ExternalFieldData,
  FieldData,
  InputObjectDefinitionData,
  InputValueData,
  InterfaceDefinitionData,
  NodeData,
  ObjectDefinitionData,
  ParentDefinitionData,
  PersistedDirectiveDefinitionData,
  PersistedDirectivesData,
  SchemaData,
} from './types';
import { MutableDefinitionNode, MutableFieldNode, MutableInputValueNode } from './ast';
import { ObjectTypeNode, setToNameNodeArray, stringToNameNode } from '../ast/utils';
import {
  incompatibleInputValueDefaultValuesError,
  invalidRepeatedFederatedDirectiveErrorMessage,
  invalidRequiredInputValueError,
} from '../errors/errors';
import { SubscriptionFilterValue } from '../router-configuration/types';
import {
  ARGUMENT,
  AUTHENTICATED,
  BOOLEAN_SCALAR,
  DEPRECATED,
  DEPRECATED_DEFAULT_ARGUMENT_VALUE,
  DIRECTIVE_DEFINITION,
  EXTERNAL,
  FLOAT_SCALAR,
  INACCESSIBLE,
  INPUT_FIELD,
  INPUT_NODE_KINDS,
  INT_SCALAR,
  KEY,
  MUTATION,
  OUTPUT_NODE_KINDS,
  PERSISTED_CLIENT_DIRECTIVES,
  QUERY,
  REASON,
  REQUIRES_SCOPES,
  ROOT_TYPE_NAMES,
  SEMANTIC_NON_NULL,
  SHAREABLE,
  STRING_SCALAR,
  SUBSCRIPTION,
} from '../utils/string-constants';
import {
  generateRequiresScopesDirective,
  generateSemanticNonNullDirective,
  generateSimpleDirective,
  getEntriesNotInHashSet,
  getFirstEntry,
} from '../utils/utils';
import { InputNodeKind, InvalidRequiredInputValueData, OutputNodeKind } from '../utils/types';
import { getDescriptionFromString } from '../v1/federation/utils';
import { DirectiveName, FieldName, SubgraphName, TypeName } from '../types/types';
import { DEFAULT_DEPRECATION_REASON } from 'graphql';

export function newPersistedDirectivesData(): PersistedDirectivesData {
  return {
    deprecatedReason: '',
    directivesByName: new Map<DirectiveName, Array<ConstDirectiveNode>>(),
    isDeprecated: false,
    tagDirectiveByName: new Map<string, ConstDirectiveNode>(),
  };
}

type IsNodeExternalOrShareableResult = {
  isExternal: boolean;
  isShareable: boolean;
};

export function isNodeExternalOrShareable(
  node: ObjectTypeNode | FieldDefinitionNode,
  areAllFieldsShareable: boolean,
  directivesByName: Map<DirectiveName, Array<ConstDirectiveNode>>,
): IsNodeExternalOrShareableResult {
  const result: IsNodeExternalOrShareableResult = {
    isExternal: directivesByName.has(EXTERNAL),
    isShareable: areAllFieldsShareable || directivesByName.has(SHAREABLE),
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
        existingData.originalCoords,
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

export function isTypeNameRootType(typeName: string, operationByTypeName: Map<TypeName, OperationTypeNode>) {
  return ROOT_TYPE_NAMES.has(typeName) || operationByTypeName.has(typeName);
}

export function getRenamedRootTypeName(
  typeName: string,
  operationByTypeName: Map<TypeName, OperationTypeNode>,
): string {
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

function propagateFieldDataArguments(fieldData: FieldData) {
  for (const argumentData of fieldData.argumentDataByName.values()) {
    // First propagate the argument's directives
    for (const directiveNodes of argumentData.directivesByName.values()) {
      argumentData.node.directives.push(...directiveNodes);
    }
    fieldData.node.arguments.push(argumentData.node);
  }
}

export function childMapToValueArray<T extends ChildData, U extends ChildDefinitionNode = T['node']>(
  map: Map<string, T>,
): Array<U> {
  const valueArray: Array<ChildDefinitionNode> = [];
  for (const childData of map.values()) {
    if (isFieldData(childData)) {
      propagateFieldDataArguments(childData);
    }
    for (const [directiveName, directiveNodes] of childData.directivesByName) {
      if (directiveName === DEPRECATED) {
        // @deprecated is non-repeatable
        const directiveNode = directiveNodes[0];
        if (!directiveNode) {
          continue;
        }
        if (directiveNode.arguments?.length) {
          childData.node.directives.push(directiveNode);
          continue;
        }
        childData.node.directives.push({
          ...directiveNode,
          arguments: [
            {
              kind: Kind.ARGUMENT,
              value: {
                kind: Kind.STRING,
                value: DEFAULT_DEPRECATION_REASON,
              },
              name: stringToNameNode(REASON),
            },
          ],
        });
        continue;
      }
      childData.node.directives.push(...directiveNodes);
    }
    valueArray.push(childData.node);
  }
  return valueArray as Array<U>;
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

export function isInterfaceDefinitionData(data: ParentDefinitionData): data is InterfaceDefinitionData {
  return data.kind === Kind.INTERFACE_TYPE_DEFINITION;
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

export function upsertDeprecatedDirective(
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

export function upsertTagDirectives(
  persistedDirectivesData: PersistedDirectivesData,
  incomingDirectiveNodes: ConstDirectiveNode[],
) {
  for (const incomingDirectiveNode of incomingDirectiveNodes) {
    // The argument was already validated in the normalization factory, so it can be safely cast
    const incomingNameString = (incomingDirectiveNode.arguments![0].value as StringValueNode).value;
    persistedDirectivesData.tagDirectiveByName.set(incomingNameString, incomingDirectiveNode);
  }
}

export function propagateAuthDirectives(parentData: ParentDefinitionData, authData?: AuthorizationData) {
  if (!authData) {
    return;
  }
  if (authData.requiresAuthentication) {
    parentData.persistedDirectivesData.directivesByName.set(AUTHENTICATED, [generateSimpleDirective(AUTHENTICATED)]);
  }
  if (authData.requiredScopes.length > 0) {
    parentData.persistedDirectivesData.directivesByName.set(REQUIRES_SCOPES, [
      generateRequiresScopesDirective(authData.requiredScopes),
    ]);
  }
}

export function propagateFieldAuthDirectives(fieldData: FieldData, authData?: AuthorizationData) {
  if (!authData) {
    return;
  }
  const fieldAuthData = authData.fieldAuthDataByFieldName.get(fieldData.name);
  if (!fieldAuthData) {
    return;
  }
  if (fieldAuthData.originalData.requiresAuthentication) {
    fieldData.persistedDirectivesData.directivesByName.set(AUTHENTICATED, [generateSimpleDirective(AUTHENTICATED)]);
  }
  if (fieldAuthData.originalData.requiredScopes.length > 0) {
    fieldData.persistedDirectivesData.directivesByName.set(REQUIRES_SCOPES, [
      generateRequiresScopesDirective(fieldAuthData.originalData.requiredScopes),
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
  directivesByName: Map<DirectiveName, Array<ConstDirectiveNode>>,
  persistedDirectiveDefinitionByName: Map<DirectiveName, DirectiveDefinitionNode>,
  directiveCoords: string,
  errors: Error[],
): ConstDirectiveNode[] {
  const persistedDirectiveNodes: Array<ConstDirectiveNode> = [];
  for (const [directiveName, directiveNodes] of directivesByName) {
    const persistedDirectiveDefinition = persistedDirectiveDefinitionByName.get(directiveName);
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
  persistedDirectiveDefinitionByName: Map<DirectiveName, DirectiveDefinitionNode>,
  errors: Error[],
): ConstDirectiveNode[] {
  const persistedDirectiveNodes = [...nodeData.persistedDirectivesData.tagDirectiveByName.values()];
  if (nodeData.persistedDirectivesData.isDeprecated) {
    persistedDirectiveNodes.push(generateDeprecatedDirective(nodeData.persistedDirectivesData.deprecatedReason));
  }
  persistedDirectiveNodes.push(
    ...getValidFlattenedPersistedDirectiveNodeArray(
      nodeData.persistedDirectivesData.directivesByName,
      persistedDirectiveDefinitionByName,
      nodeData.name,
      errors,
    ),
  );
  return persistedDirectiveNodes;
}

export function getClientPersistedDirectiveNodes<T extends NodeData>(nodeData: T): ConstDirectiveNode[] {
  const persistedDirectiveNodes: Array<ConstDirectiveNode> = [];
  if (nodeData.persistedDirectivesData.isDeprecated) {
    persistedDirectiveNodes.push(generateDeprecatedDirective(nodeData.persistedDirectivesData.deprecatedReason));
  }
  for (const [directiveName, directiveNodes] of nodeData.persistedDirectivesData.directivesByName) {
    if (directiveName === SEMANTIC_NON_NULL && isFieldData(nodeData)) {
      persistedDirectiveNodes.push(
        generateSemanticNonNullDirective(getFirstEntry(nodeData.nullLevelsBySubgraphName) ?? new Set<number>([0])),
      );
      continue;
    }
    // Only include @deprecated, @oneOf, and @semanticNonNull in the client schema.
    if (!PERSISTED_CLIENT_DIRECTIVES.has(directiveName)) {
      continue;
    }
    /* Persisted client-facing directives are all non-repeatable.
     ** The directive is validated against the definition when creating the router schema node, so it is not necessary
     ** to validate again. */
    persistedDirectiveNodes.push(directiveNodes[0]);
  }
  return persistedDirectiveNodes;
}

export function getClientSchemaFieldNodeByFieldData(fieldData: FieldData): MutableFieldNode {
  const directives = getClientPersistedDirectiveNodes(fieldData);
  const argumentNodes: MutableInputValueNode[] = [];
  for (const inputValueData of fieldData.argumentDataByName.values()) {
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
  persistedDirectiveDefinitionByDirectiveName: Map<DirectiveName, DirectiveDefinitionNode>,
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

function addValidatedArgumentNodes(
  argumentNodes: MutableInputValueNode[],
  hostData: PersistedDirectiveDefinitionData,
  persistedDirectiveDefinitionByDirectiveName: Map<DirectiveName, DirectiveDefinitionNode>,
  errors: Error[],
  argumentNamesForFieldConfiguration?: Set<string>,
): boolean {
  const invalidRequiredArgumentErrors: InvalidRequiredInputValueData[] = [];
  for (const [argumentName, argumentData] of hostData.argumentDataByName) {
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
  definitions: (MutableDefinitionNode | DefinitionNode)[],
  data: PersistedDirectiveDefinitionData,
  persistedDirectiveDefinitionByDirectiveName: Map<DirectiveName, DirectiveDefinitionNode>,
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
  subgraphNamesByExternalFieldName: Map<FieldName, Array<SubgraphName>>;
};

export function newInvalidFieldNames() {
  return {
    byShareable: new Set<string>(),
    subgraphNamesByExternalFieldName: new Map<FieldName, Array<SubgraphName>>(),
  };
}

export function validateExternalAndShareable(fieldData: FieldData, invalidFieldNames: InvalidFieldNames) {
  // fieldData.subgraphNames.size is not used due to overridden fields
  const instances = fieldData.isShareableBySubgraphName.size;
  let externalFieldSubgraphNames = new Array<SubgraphName>();
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
  concreteTypeNamesByAbstractTypeName: Map<TypeName, Set<TypeName>>,
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
  return data.persistedDirectivesData.directivesByName.has(INACCESSIBLE) || data.directivesByName.has(INACCESSIBLE);
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

export function getParentTypeName(parentData: CompositeOutputData): TypeName {
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

export function getDefinitionDataCoords(data: NodeData, useFederatedCoords: boolean): string {
  switch (data.kind) {
    case Kind.ENUM_VALUE_DEFINITION: {
      return `${data.parentTypeName}.${data.name}`;
    }
    case Kind.FIELD_DEFINITION: {
      return `${useFederatedCoords ? data.renamedParentTypeName : data.originalParentTypeName}.${data.name}`;
    }
    case Kind.ARGUMENT:
    // intentional fallthrough
    case Kind.INPUT_VALUE_DEFINITION: {
      return useFederatedCoords ? data.federatedCoords : data.originalCoords;
    }
    case Kind.OBJECT_TYPE_DEFINITION: {
      return useFederatedCoords ? data.renamedTypeName : data.name;
    }
    default:
      return data.name;
  }
}

export function isParentDataCompositeOutputType(
  data: ParentDefinitionData,
): data is ObjectDefinitionData | InterfaceDefinitionData {
  return data.kind === Kind.OBJECT_TYPE_DEFINITION || data.kind === Kind.INTERFACE_TYPE_DEFINITION;
}

export function newExternalFieldData(isDefinedExternal: boolean): ExternalFieldData {
  return {
    isDefinedExternal,
    isUnconditionallyProvided: !isDefinedExternal,
  };
}

export function getInitialFederatedDescription(data: NodeData): StringValueNode | undefined {
  const { value, done } = data.configureDescriptionDataBySubgraphName.values().next();
  if (done) {
    return data.description;
  }
  if (!value.propagate) {
    return;
  }
  return getDescriptionFromString(value.description) || data.description;
}

export function areKindsEqual<T extends ParentDefinitionData>(a: T, b: ParentDefinitionData): b is T {
  return a.kind === b.kind;
}

export function isFieldData(data: ChildData | NodeData | SchemaData): data is FieldData {
  return data.kind === Kind.FIELD_DEFINITION;
}

export function isInputObjectDefinitionData(data: ParentDefinitionData): data is InputObjectDefinitionData {
  return data.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION;
}

export function isInputNodeKind(kind: Kind): kind is InputNodeKind {
  return INPUT_NODE_KINDS.has(kind);
}

export function isOutputNodeKind(kind: Kind): kind is OutputNodeKind {
  return OUTPUT_NODE_KINDS.has(kind);
}
