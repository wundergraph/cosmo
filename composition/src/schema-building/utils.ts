import {
  type ASTNode,
  type BooleanValueNode,
  type ConstDirectiveNode,
  type ConstValueNode,
  DEFAULT_DEPRECATION_REASON,
  type EnumValueDefinitionNode,
  type EnumValueNode,
  type FieldDefinitionNode,
  type FloatValueNode,
  type InputValueDefinitionNode,
  type IntValueNode,
  Kind,
  type NullValueNode,
  OperationTypeNode,
  print,
  type StringValueNode,
  type TypeNode,
  visit,
} from 'graphql';

// graphql v16's CJS root re-exports enum objects through getters; keep hot-path reads local.
const KindRef = Kind;
const OperationTypeNodeRef = OperationTypeNode;

import {
  type AuthorizationData,
  type ChildData,
  type CompositeOutputData,
  type ConditionalFieldData,
  type DefinitionData,
  type EnumDefinitionData,
  type EnumValueData,
  ExtensionType,
  type ExternalFieldData,
  type FederatedDirectivesData,
  type FieldData,
  type InputObjectDefinitionData,
  type InterfaceDefinitionData,
  type NodeData,
  type ObjectDefinitionData,
  type ParentDefinitionData,
  type SchemaData,
} from './types/types';
import { type MutableFieldNode, type MutableInputValueNode } from './ast';
import {
  type InterfaceTypeNode,
  type ObjectTypeNode,
  type ParentTypeNode,
  setToNameNodeArray,
  stringToNameNode,
} from '../ast/utils';
import { incompatibleInputValueDefaultValuesError, invalidRequiredInputValueError } from '../errors/errors';
import { type SubscriptionFilterValue } from '../router-configuration/types';
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
  INTERFACE_NODE_KINDS,
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
import { type InputNodeKind, type InvalidRequiredInputValueData, type OutputNodeKind } from '../utils/types';
import { getDescriptionFromString } from '../v1/federation/utils';
import { type DirectiveName, type FieldName, type SubgraphName, type TypeName } from '../types/types';
import {
  type CompareAndValidateInputDefaultValuesParams,
  type DirectiveDefinitionNodeFromDataParams,
  type GetRouterFederatedDirectiveNodesParams,
  type GetValidArgumentNodesParams,
  type IsTypeValidImplementationParams,
  type RouterSchemaFieldNodeFromDataParams,
  type RouterSchemaInputValueNodeFromDataParams,
  type RouterSchemaNodeFromDataParams,
  type SanitizeDefaultValueParams,
} from './types/params';
import {
  type GetFederatedDirectiveNodesResult,
  type InputValueNodesResult,
  type RouterSchemaFieldNodeFromDataResult,
  type RouterSchemaInputValueNodeFromDataResult,
  type RouterSchemaNodeFromDataResult,
} from './types/results';
import { validateDirectives } from '../validation/validation';
import { type ExecutionMultiResult, type ExecutionSingleFailureResult } from '../types/results';
import { type DirectiveArgumentData } from '../directive-definition-data/types/types';
import { type Warning } from '../warnings/types';
import { invalidRepeatedComposedDirectiveWarning } from '../v1/warnings/warnings';
import { FEDERATED_DIRECTIVE_DATAS } from '../v1/normalization/utils';
import { ROUTER_FEDERATED_DIRECTIVE_NAMES } from '../v1/constants/strings';

export function newFederatedDirectivesData(): FederatedDirectivesData {
  // The maps are intentionally left undefined; they are lazily allocated upon first write.
  return {
    deprecatedReason: '',
    directivesByName: undefined,
    isDeprecated: false,
    tagDirectiveByName: undefined,
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
  return node.kind === KindRef.NON_NULL_TYPE;
}

export function isTypeNodeListType(node: TypeNode): boolean {
  switch (node.kind) {
    case KindRef.LIST_TYPE:
      return true;
    case KindRef.NON_NULL_TYPE:
      return isTypeNodeListType(node.type);
    default:
      return false;
  }
}

// TODO replace naïve comparison
export function areDefaultValuesCompatible(typeNode: TypeNode, incomingDefaultValue: ConstValueNode): boolean {
  switch (typeNode.kind) {
    case KindRef.LIST_TYPE:
      return incomingDefaultValue.kind === KindRef.LIST || incomingDefaultValue.kind === KindRef.NULL;
    case KindRef.NAMED_TYPE:
      if (incomingDefaultValue.kind === KindRef.NULL) {
        return true;
      }
      switch (typeNode.name.value) {
        case BOOLEAN_SCALAR:
          return incomingDefaultValue.kind === KindRef.BOOLEAN;
        case FLOAT_SCALAR:
          return incomingDefaultValue.kind === KindRef.INT || incomingDefaultValue.kind === KindRef.FLOAT;
        case INT_SCALAR:
          return incomingDefaultValue.kind === KindRef.INT;
        case STRING_SCALAR:
          return incomingDefaultValue.kind === KindRef.STRING;
        default:
          return true;
      }
    case KindRef.NON_NULL_TYPE:
      if (incomingDefaultValue.kind === KindRef.NULL) {
        return false;
      }
      return areDefaultValuesCompatible(typeNode.type, incomingDefaultValue);
  }
}

/* Caches the printed value of an AST node by node identity. This is only safe for nodes that are never mutated
 * in place after being printed, e.g., directive nodes and input default value nodes, which are always replaced
 * wholesale rather than mutated. */
const printedValueByNode = new WeakMap<ASTNode, string>();

function cachedPrint(node: ASTNode): string {
  let printedValue = printedValueByNode.get(node);
  if (printedValue === undefined) {
    printedValue = print(node);
    printedValueByNode.set(node, printedValue);
  }
  return printedValue;
}

export function compareAndValidateInputDefaultValues({
  existingData,
  incomingData,
}: CompareAndValidateInputDefaultValuesParams): ExecutionSingleFailureResult {
  if (!existingData.defaultValue) {
    // TODO warning if default value in incoming
    return {
      success: true,
    };
  }
  if (!incomingData.defaultValue) {
    // TODO warning
    existingData.includeDefaultValue = false;
    return {
      success: true,
    };
  }
  const existingDefaultValueString = cachedPrint(existingData.defaultValue);
  const incomingDefaultValueString = cachedPrint(incomingData.defaultValue);
  if (existingDefaultValueString == incomingDefaultValueString) {
    return {
      success: true,
    };
  }

  return {
    error: incompatibleInputValueDefaultValuesError(
      `${existingData.kind === KindRef.ARGUMENT ? ARGUMENT : INPUT_FIELD} "${existingData.name}"`,
      existingData.originalCoords,
      [...incomingData.subgraphNames],
      existingDefaultValueString,
      incomingDefaultValueString,
    ),
    success: false,
  };
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
    case OperationTypeNodeRef.MUTATION:
      return MUTATION;
    case OperationTypeNodeRef.SUBSCRIPTION:
      return SUBSCRIPTION;
    default:
      return QUERY;
  }
}
type ChildDefinitionNode = EnumValueDefinitionNode | FieldDefinitionNode | InputValueDefinitionNode;

function propagateFieldDataArguments(fieldData: FieldData) {
  if (!fieldData.argumentDataByName) {
    return;
  }
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
              kind: KindRef.ARGUMENT,
              value: {
                kind: KindRef.STRING,
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
  if ('configureDescriptionDataBySubgraphName' in incomingData && incomingData.configureDescriptionDataBySubgraphName) {
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
  if (parentData.kind !== KindRef.OBJECT_TYPE_DEFINITION) {
    return false;
  }
  return parentData.isRootType;
}

export function isInterfaceDefinitionData(data: ParentDefinitionData): data is InterfaceDefinitionData {
  return data.kind === KindRef.INTERFACE_TYPE_DEFINITION;
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
  federatedDirectivesData: FederatedDirectivesData,
  incomingDirectiveNode: ConstDirectiveNode,
) {
  if (!incomingDirectiveNode.arguments?.length) {
    return;
  }
  // The argument was already validated in the normalization factory, so it can be safely cast
  const incomingReasonString = (incomingDirectiveNode.arguments[0].value as StringValueNode).value;
  if (federatedDirectivesData.deprecatedReason.length < incomingReasonString.length) {
    federatedDirectivesData.deprecatedReason = incomingReasonString;
  }
}

export function upsertTagDirectives(
  federatedDirectivesData: FederatedDirectivesData,
  incomingDirectiveNodes: ConstDirectiveNode[],
) {
  const tagDirectiveByName = (federatedDirectivesData.tagDirectiveByName ??= new Map<string, ConstDirectiveNode>());
  for (const incomingDirectiveNode of incomingDirectiveNodes) {
    // The argument was already validated in the normalization factory, so it can be safely cast
    const incomingNameString = (incomingDirectiveNode.arguments![0].value as StringValueNode).value;
    tagDirectiveByName.set(incomingNameString, incomingDirectiveNode);
  }
}

export function propagateAuthDirectives(parentData: ParentDefinitionData, authData?: AuthorizationData) {
  if (!authData) {
    return;
  }
  if (authData.requiresAuthentication) {
    (parentData.federatedDirectivesData.directivesByName ??= new Map<DirectiveName, Array<ConstDirectiveNode>>()).set(
      AUTHENTICATED,
      [generateSimpleDirective(AUTHENTICATED)],
    );
  }
  if (authData.requiredScopes.length > 0) {
    (parentData.federatedDirectivesData.directivesByName ??= new Map<DirectiveName, Array<ConstDirectiveNode>>()).set(
      REQUIRES_SCOPES,
      [generateRequiresScopesDirective(authData.requiredScopes)],
    );
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
    (fieldData.federatedDirectivesData.directivesByName ??= new Map<DirectiveName, Array<ConstDirectiveNode>>()).set(
      AUTHENTICATED,
      [generateSimpleDirective(AUTHENTICATED)],
    );
  }
  if (fieldAuthData.originalData.requiredScopes.length > 0) {
    (fieldData.federatedDirectivesData.directivesByName ??= new Map<DirectiveName, Array<ConstDirectiveNode>>()).set(
      REQUIRES_SCOPES,
      [generateRequiresScopesDirective(fieldAuthData.originalData.requiredScopes)],
    );
  }
}

export function generateDeprecatedDirective(reason: string): ConstDirectiveNode {
  return {
    kind: KindRef.DIRECTIVE,
    name: stringToNameNode(DEPRECATED),
    arguments: [
      {
        kind: KindRef.ARGUMENT,
        name: stringToNameNode(REASON),
        value: {
          kind: KindRef.STRING,
          value: reason || DEPRECATED_DEFAULT_ARGUMENT_VALUE, // use the default value if reason is empty
        },
      },
    ],
  };
}

export function getNodeCoords(data: NodeData): string {
  switch (data.kind) {
    case KindRef.ARGUMENT:
    // Intentional fallthrough
    case KindRef.FIELD_DEFINITION:
    // Intentional fallthrough
    case KindRef.INPUT_VALUE_DEFINITION:
    // Intentional fallthrough
    case KindRef.ENUM_VALUE_DEFINITION: {
      return data.federatedCoords;
    }
    default: {
      return data.name;
    }
  }
}

export function extractUniqueDirectiveNodes(directiveNodes: Array<ConstDirectiveNode>): Array<ConstDirectiveNode> {
  const nodes: Array<ConstDirectiveNode> = [];
  const printedNodes = new Set<string>();
  for (const directiveNode of directiveNodes) {
    const directive = cachedPrint(directiveNode);
    if (printedNodes.has(directive)) {
      continue;
    }
    printedNodes.add(directive);
    nodes.push(directiveNode);
  }
  return nodes;
}

export function getRouterSchemaDirectiveNodes({
  data,
  federatedDirectiveDataByName,
  parentDefinitionDataByTypeName,
}: GetRouterFederatedDirectiveNodesParams): GetFederatedDirectiveNodesResult {
  const nodes: Array<ConstDirectiveNode> = data.federatedDirectivesData.tagDirectiveByName
    ? [...data.federatedDirectivesData.tagDirectiveByName.values()]
    : [];
  if (data.federatedDirectivesData.isDeprecated) {
    nodes.push(generateDeprecatedDirective(data.federatedDirectivesData.deprecatedReason));
  }
  const coords = getNodeCoords(data);
  const errors: Array<Error> = [];
  const warnings: Array<Warning> = [];
  for (const [directiveName, directiveNodes] of data.federatedDirectivesData.directivesByName ?? []) {
    if (directiveName === SEMANTIC_NON_NULL && isFieldData(data)) {
      nodes.push(
        generateSemanticNonNullDirective(getFirstEntry(data.nullLevelsBySubgraphName) ?? new Set<number>([0])),
      );
      continue;
    }
    const directiveData = federatedDirectiveDataByName.get(directiveName);
    if (!directiveData) {
      continue;
    }

    // Executable directives are propagated but not their in-schema usages
    if (!directiveData.isComposed && !ROUTER_FEDERATED_DIRECTIVE_NAMES.has(directiveName)) {
      continue;
    }
    /* The Apollo behaviour is that composed directive must be referenced within at least one composing subgraph else
     * no usages are propagated into the federated graph.
     * It's likely this behaviour is a bug, but it's mirrored here for consistency.
     */
    if (directiveData.isComposed && !directiveData.isReferenced) {
      continue;
    }

    if (directiveNodes.length < 2) {
      nodes.push(...directiveNodes);
      continue;
    }

    const uniqueDirectiveNodes = extractUniqueDirectiveNodes(directiveNodes);
    const validationResult = validateDirectives({
      data,
      directiveCoords: coords,
      directiveDefinitionData: directiveData,
      directiveNodes: uniqueDirectiveNodes,
      parentDefinitionDataByTypeName,
    });
    if (!validationResult.success) {
      errors.push(...validationResult.errors);
      continue;
    }

    if (uniqueDirectiveNodes.length > 1 && directiveData.isComposed && !directiveData.isRepeatable) {
      warnings.push(
        invalidRepeatedComposedDirectiveWarning({
          directiveCoords: coords,
          directiveName,
          printedDirective: print(uniqueDirectiveNodes[0]),
        }),
      );
      nodes.push(uniqueDirectiveNodes[0]);
      continue;
    }

    nodes.push(...uniqueDirectiveNodes);
  }

  if (errors.length > 0) {
    return {
      errors,
      success: false,
    };
  }

  return {
    nodes,
    success: true,
    warnings,
  };
}

export function getClientFederatedDirectiveNodes<T extends NodeData>(nodeData: T): ConstDirectiveNode[] {
  const persistedDirectiveNodes: Array<ConstDirectiveNode> = [];
  if (nodeData.federatedDirectivesData.isDeprecated) {
    persistedDirectiveNodes.push(generateDeprecatedDirective(nodeData.federatedDirectivesData.deprecatedReason));
  }
  for (const [directiveName, directiveNodes] of nodeData.federatedDirectivesData.directivesByName ?? []) {
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
  const directives = getClientFederatedDirectiveNodes(fieldData);
  const argumentNodes: MutableInputValueNode[] = [];
  for (const inputValueData of fieldData.argumentDataByName?.values() ?? []) {
    if (isNodeDataInaccessible(inputValueData)) {
      continue;
    }
    argumentNodes.push({
      ...inputValueData.node,
      directives: getClientFederatedDirectiveNodes(inputValueData),
    });
  }
  return {
    ...fieldData.node,
    directives,
    arguments: argumentNodes,
  };
}

export function routerSchemaFieldNodeFromData({
  argumentNodes,
  data,
  description,
  federatedDirectiveDataByName,
  parentDefinitionDataByTypeName,
}: RouterSchemaFieldNodeFromDataParams): RouterSchemaFieldNodeFromDataResult {
  data.node.arguments = argumentNodes;
  data.node.description = description;
  data.node.name = stringToNameNode(data.name);
  data.node.type = data.type;
  const directivesResult = getRouterSchemaDirectiveNodes({
    federatedDirectiveDataByName,
    data: data,
    parentDefinitionDataByTypeName,
  });
  if (!directivesResult.success) {
    return directivesResult;
  }

  data.node.directives = directivesResult.nodes;

  return {
    node: data.node,
    success: true,
    warnings: directivesResult.warnings,
  };
}

export function routerSchemaInputValueNodeFromData({
  data,
  description,
  federatedDirectiveDataByName,
  parentDefinitionDataByTypeName,
}: RouterSchemaInputValueNodeFromDataParams): RouterSchemaInputValueNodeFromDataResult {
  data.node.description = description;
  data.node.name = stringToNameNode(data.name);
  data.node.type = data.type;
  if (data.includeDefaultValue) {
    data.node.defaultValue = data.defaultValue;
  }
  const directivesResult = getRouterSchemaDirectiveNodes({
    data,
    federatedDirectiveDataByName,
    parentDefinitionDataByTypeName,
  });
  if (!directivesResult.success) {
    return directivesResult;
  }

  data.node.directives = directivesResult.nodes;

  return {
    node: data.node,
    success: true,
    warnings: directivesResult.warnings,
  };
}

export function routerSchemaNodeFromData<T extends ParentDefinitionData | EnumValueData>({
  data,
  description,
  federatedDirectiveDataByName,
  parentDefinitionDataByTypeName,
}: RouterSchemaNodeFromDataParams): RouterSchemaNodeFromDataResult<T['node']> {
  data.node.description = description;
  data.node.name = stringToNameNode(data.name);
  const directivesResult = getRouterSchemaDirectiveNodes({
    federatedDirectiveDataByName,
    data: data,
    parentDefinitionDataByTypeName,
  });
  if (!directivesResult.success) {
    return directivesResult;
  }

  data.node.directives = directivesResult.nodes;

  return {
    node: data.node,
    success: true,
    warnings: directivesResult.warnings,
  };
}

function getValidFederatedDirectiveArgumentNodes({
  data,
  federatedDirectiveDataByName,
  parentDefinitionDataByTypeName,
}: GetValidArgumentNodesParams): InputValueNodesResult {
  const errors: Array<Error> = [];
  const warnings: Array<Warning> = [];
  const invalidRequiredArgumentErrors: Array<InvalidRequiredInputValueData> = [];
  const nodes: Array<MutableInputValueNode> = [];
  for (const [argumentName, argumentData] of data.argumentDataByName) {
    const missingSubgraphs = getEntriesNotInHashSet(data.subgraphNames, argumentData.subgraphNames);
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
      data.optionalArgumentNames.delete(argumentName);
      continue;
    }

    const argNodeResult = routerSchemaInputValueNodeFromData({
      data: argumentData,
      federatedDirectiveDataByName,
      parentDefinitionDataByTypeName,
    });
    if (!argNodeResult.success) {
      errors.push(...argNodeResult.errors);
      continue;
    }

    nodes.push(argNodeResult.node);
    warnings.push(...argNodeResult.warnings);
  }

  if (invalidRequiredArgumentErrors.length > 0) {
    errors.push(invalidRequiredInputValueError(DIRECTIVE_DEFINITION, `@${data.name}`, invalidRequiredArgumentErrors));
  }

  if (errors.length > 0) {
    return {
      errors,
      success: false,
    };
  }

  return {
    nodes,
    success: true,
    warnings,
  };
}

export function propagateDirectiveDefinitionNodeFromData({
  data,
  federatedDirectiveDataByName,
  parentDefinitionDataByTypeName,
}: DirectiveDefinitionNodeFromDataParams): ExecutionMultiResult {
  const argumentNodesResult = getValidFederatedDirectiveArgumentNodes({
    data,
    federatedDirectiveDataByName,
    parentDefinitionDataByTypeName,
  });
  if (!argumentNodesResult.success) {
    return argumentNodesResult;
  }

  data.node = {
    arguments: argumentNodesResult.nodes,
    kind: KindRef.DIRECTIVE_DEFINITION,
    locations: setToNameNodeArray(data.locations),
    name: stringToNameNode(data.name),
    repeatable: data.isRepeatable,
    description: data.description,
  };

  return {
    success: true,
  };
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

export function isTypeValidImplementation({
  concreteTypeNamesByAbstractTypeName,
  implementationType,
  interfaceImplementationTypeNamesByInterfaceTypeName,
  originalType,
}: IsTypeValidImplementationParams): boolean {
  if (originalType.kind === KindRef.NON_NULL_TYPE) {
    if (implementationType.kind !== KindRef.NON_NULL_TYPE) {
      return false;
    }
    return isTypeValidImplementation({
      concreteTypeNamesByAbstractTypeName,
      implementationType: implementationType.type,
      interfaceImplementationTypeNamesByInterfaceTypeName,
      originalType: originalType.type,
    });
  }
  if (implementationType.kind === KindRef.NON_NULL_TYPE) {
    return isTypeValidImplementation({
      concreteTypeNamesByAbstractTypeName,
      implementationType: implementationType.type,
      interfaceImplementationTypeNamesByInterfaceTypeName,
      originalType,
    });
  }
  switch (originalType.kind) {
    case KindRef.NAMED_TYPE:
      if (implementationType.kind === KindRef.NAMED_TYPE) {
        const originalTypeName = originalType.name.value;
        const implementationTypeName = implementationType.name.value;
        if (originalTypeName === implementationTypeName) {
          return true;
        }
        const abstractTypes = interfaceImplementationTypeNamesByInterfaceTypeName.get(originalTypeName);
        const concreteTypes = concreteTypeNamesByAbstractTypeName.get(originalTypeName);
        return !!(concreteTypes?.has(implementationTypeName) || abstractTypes?.has(implementationTypeName));
      }
      return false;
    default:
      if (implementationType.kind === KindRef.LIST_TYPE) {
        return isTypeValidImplementation({
          concreteTypeNamesByAbstractTypeName,
          implementationType: implementationType.type,
          interfaceImplementationTypeNamesByInterfaceTypeName,
          originalType: originalType.type,
        });
      }
      return false;
  }
}

export function isNodeDataInaccessible(data: NodeData): boolean {
  return data.federatedDirectivesData.directivesByName?.has(INACCESSIBLE) || data.directivesByName.has(INACCESSIBLE);
}

export function isLeafKind(kind: Kind): boolean {
  return kind === KindRef.SCALAR_TYPE_DEFINITION || kind === KindRef.ENUM_TYPE_DEFINITION;
}

export function getSubscriptionFilterValue(
  valueNode: BooleanValueNode | EnumValueNode | FloatValueNode | IntValueNode | NullValueNode | StringValueNode,
): SubscriptionFilterValue {
  switch (valueNode.kind) {
    case KindRef.BOOLEAN: {
      return valueNode.value;
    }
    case KindRef.ENUM:
    // intentional fallthrough
    case KindRef.STRING: {
      return valueNode.value;
    }
    case KindRef.FLOAT:
    // intentional fallthrough
    case KindRef.INT: {
      // The incoming value should never not be a number but wrap in a catch just in case
      try {
        return parseFloat(valueNode.value);
      } catch {
        return 'NaN';
      }
    }
    case KindRef.NULL: {
      return null;
    }
  }
}

export function getParentTypeName(parentData: CompositeOutputData): TypeName {
  if (parentData.kind === KindRef.OBJECT_TYPE_DEFINITION) {
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
    case KindRef.ENUM_VALUE_DEFINITION: {
      return `${data.parentTypeName}.${data.name}`;
    }
    case KindRef.FIELD_DEFINITION: {
      return `${useFederatedCoords ? data.renamedParentTypeName : data.originalParentTypeName}.${data.name}`;
    }
    case KindRef.ARGUMENT:
    // intentional fallthrough
    case KindRef.INPUT_VALUE_DEFINITION: {
      return useFederatedCoords ? data.federatedCoords : data.originalCoords;
    }
    case KindRef.OBJECT_TYPE_DEFINITION: {
      return useFederatedCoords ? data.renamedTypeName : data.name;
    }
    default:
      return data.name;
  }
}

export function isParentDataCompositeOutputType(
  data: ParentDefinitionData,
): data is ObjectDefinitionData | InterfaceDefinitionData {
  return data.kind === KindRef.OBJECT_TYPE_DEFINITION || data.kind === KindRef.INTERFACE_TYPE_DEFINITION;
}

export const UNCONDITIONALLY_PROVIDED_EXTERNAL_FIELD_DATA: ExternalFieldData = Object.freeze({
  isDefinedExternal: false,
  isUnconditionallyProvided: true,
});

export function newExternalFieldData(isDefinedExternal: boolean): ExternalFieldData {
  if (!isDefinedExternal) {
    return UNCONDITIONALLY_PROVIDED_EXTERNAL_FIELD_DATA;
  }
  // Safe to share the non-external singleton: the only mutation site is guarded by
  // isDefinedExternal === true, and cross-phase copies spread-clone map values.
  return {
    isDefinedExternal: true,
    isUnconditionallyProvided: false,
  };
}

export function getInitialFederatedDescription(data: NodeData | DirectiveArgumentData): StringValueNode | undefined {
  const { value, done } = data.configureDescriptionDataBySubgraphName?.values().next() ?? { done: true };
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
  return data.kind === KindRef.FIELD_DEFINITION;
}

export function isInputObjectDefinitionData(data: ParentDefinitionData): data is InputObjectDefinitionData {
  return data.kind === KindRef.INPUT_OBJECT_TYPE_DEFINITION;
}

export function isInputNodeKind(kind: Kind): kind is InputNodeKind {
  return INPUT_NODE_KINDS.has(kind);
}

export function isOutputNodeKind(kind: Kind): kind is OutputNodeKind {
  return OUTPUT_NODE_KINDS.has(kind);
}

export function isInterfaceNode(node: ParentTypeNode): node is InterfaceTypeNode {
  return INTERFACE_NODE_KINDS.has(node.kind);
}

export function isEnumData(data: ParentDefinitionData): data is EnumDefinitionData {
  return data.kind === KindRef.ENUM_TYPE_DEFINITION;
}

export function sanitizeDefaultValue({ data, namedTypeData, node }: SanitizeDefaultValueParams) {
  if (!data.defaultValue) {
    return;
  }

  if (!isEnumData(namedTypeData)) {
    return;
  }

  data.defaultValue = visit(data.defaultValue, {
    StringValue: {
      enter(node) {
        return {
          kind: KindRef.ENUM,
          value: node.value,
        };
      },
    },
  });

  if (node) {
    node.defaultValue = data.defaultValue;
  }
}
