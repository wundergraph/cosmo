import {
  type ConstDirectiveNode,
  type DirectiveNode,
  type DocumentNode,
  type EnumValueDefinitionNode,
  type FieldDefinitionNode,
  type InputValueDefinitionNode,
  type OperationTypeDefinitionNode,
  Kind,
  visit,
} from 'graphql';

// graphql v16's CJS root re-exports enum objects through getters; keep hot walker reads local.
const KindRef = Kind;

import {
  duplicateEnumValueDefinitionError,
  duplicateFieldDefinitionError,
  duplicateInputFieldDefinitionError,
  duplicateOperationTypeDefinitionError,
  invalidOperationTypeDefinitionError,
  unexpectedParentKindForChildError,
} from '../../errors/errors';
import { type NormalizationFactory } from './normalization-factory';
import { BASE_SCALARS, V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME } from '../constants/constants';
import { upsertEntityData } from '../utils/utils';
import {
  formatDescription,
  type InterfaceTypeNode,
  isNodeInterfaceObject,
  isObjectLikeNodeEntity,
  type ObjectTypeNode,
} from '../../ast/utils';
import { extractFieldSetValue, newFieldSetData } from './utils';
import { EVENT_DIRECTIVE_NAMES } from '../constants/strings';
import {
  getRenamedRootTypeName,
  isParentDataCompositeOutputType,
  isTypeNameRootType,
  newFederatedDirectivesData,
} from '../../schema-building/utils';
import { type ConfigureDescriptionData, type InputValueData } from '../../schema-building/types/types';
import { getMutableEnumValueNode, getTypeNodeNamedTypeName } from '../../schema-building/ast';
import { type GraphNode, type RootNode } from '../../resolvability-graph/graph-nodes';
import { requiresDefinedOnNonEntityFieldWarning } from '../warnings/warnings';
import {
  ANY_SCALAR,
  COMPOSE_DIRECTIVE,
  ENTITY_UNION,
  IGNORED_FIELDS,
  PARENT_DEFINITION_DATA,
  PROVIDES,
  REQUIRES,
  SERVICE_OBJECT,
} from '../../utils/string-constants';
import { type RootTypeName } from '../../utils/types';
import { getOrThrowError, getValueOrDefault, kindToNodeType } from '../../utils/utils';
import { CompactMap, CompactSet } from '../../utils/compact-collections';
import { type KeyFieldSetData } from './types/types';
import { type FieldName, type TypeName } from '../../types/types';

function visitDirectiveNode(nf: NormalizationFactory, node: DirectiveNode) {
  const name = node.name.value;
  nf.referencedDirectiveNames.add(name);
  if (EVENT_DIRECTIVE_NAMES.has(name)) {
    nf.edfsDirectiveReferences.add(name);
    return;
  }
  if (V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME.has(name)) {
    nf.isSubgraphVersionTwo = true;
  }
}

function visitDirectiveNodes(nf: NormalizationFactory, nodes: ReadonlyArray<ConstDirectiveNode> | undefined) {
  if (!nodes) {
    return;
  }
  for (const directiveNode of nodes) {
    visitDirectiveNode(nf, directiveNode);
  }
}

/* Visits directive usages in the same order as graphql-js visit():
 * the directives of the type itself before, for each field, the directives of each field argument
 * before the directives of the field itself. */
function visitCompositeOutputDirectiveNodes(nf: NormalizationFactory, node: InterfaceTypeNode | ObjectTypeNode) {
  visitDirectiveNodes(nf, node.directives);
  if (!node.fields) {
    return;
  }
  for (const fieldNode of node.fields) {
    if (fieldNode.arguments) {
      for (const inputValueNode of fieldNode.arguments) {
        visitDirectiveNodes(nf, inputValueNode.directives);
      }
    }
    visitDirectiveNodes(nf, fieldNode.directives);
  }
}

function visitOperationTypeDefinitionNode(nf: NormalizationFactory, node: OperationTypeDefinitionNode) {
  const operationType = node.operation;
  const operationTypeNode = nf.schemaData.operationTypes.get(operationType);
  const namedTypeName = getTypeNodeNamedTypeName(node.type);
  if (operationTypeNode) {
    nf.errors.push(
      duplicateOperationTypeDefinitionError(
        operationType,
        namedTypeName,
        getTypeNodeNamedTypeName(operationTypeNode.type),
      ),
    );
    return;
  }
  const existingOperationType = nf.operationTypeNodeByTypeName.get(namedTypeName);
  if (existingOperationType) {
    nf.errors.push(invalidOperationTypeDefinitionError(existingOperationType, namedTypeName, operationType));
    return;
  }
  nf.operationTypeNodeByTypeName.set(namedTypeName, operationType);
  nf.schemaData.operationTypes.set(operationType, node);
}

/* Walker to collect schema definition, directive definitions, and entities.
 * Directives are not validated upon immediate extract because all types must be recorded first.
 * * */
export function upsertDirectiveSchemaAndEntityDefinitions(nf: NormalizationFactory, document: DocumentNode) {
  for (const definitionNode of document.definitions) {
    switch (definitionNode.kind) {
      case KindRef.DIRECTIVE_DEFINITION: {
        if (nf.addDirectiveDefinitionDataByNode(definitionNode)) {
          nf.customDirectiveDefinitionByName.set(definitionNode.name.value, definitionNode);
        }
        // Directives on the definition's arguments are intentionally not visited.
        break;
      }
      case KindRef.ENUM_TYPE_DEFINITION:
      case KindRef.ENUM_TYPE_EXTENSION: {
        visitDirectiveNodes(nf, definitionNode.directives);
        if (definitionNode.values) {
          for (const enumValueNode of definitionNode.values) {
            visitDirectiveNodes(nf, enumValueNode.directives);
          }
        }
        break;
      }
      case KindRef.INPUT_OBJECT_TYPE_DEFINITION:
      case KindRef.INPUT_OBJECT_TYPE_EXTENSION: {
        visitDirectiveNodes(nf, definitionNode.directives);
        if (definitionNode.fields) {
          for (const inputValueNode of definitionNode.fields) {
            visitDirectiveNodes(nf, inputValueNode.directives);
          }
        }
        break;
      }
      case KindRef.INTERFACE_TYPE_DEFINITION:
      case KindRef.INTERFACE_TYPE_EXTENSION: {
        const typeName = definitionNode.name.value;
        nf.internalGraph.addOrUpdateNode(typeName, { isAbstract: true });
        if (isObjectLikeNodeEntity(definitionNode)) {
          const keyFieldSetDataByFieldSet = getValueOrDefault(
            nf.keyFieldSetDatasByTypeName,
            typeName,
            () => new Map<string, KeyFieldSetData>(),
          );
          nf.extractKeyFieldSets(definitionNode, keyFieldSetDataByFieldSet);
          upsertEntityData({
            entityDataByTypeName: nf.entityDataByTypeName,
            keyFieldSetDataByFieldSet,
            subgraphName: nf.subgraphName,
            typeName,
          });
          getValueOrDefault(nf.entityInterfaceDataByTypeName, typeName, () => ({
            concreteTypeNames: new Set<TypeName>(),
            fieldDatas: [],
            interfaceFieldNames: new Set<FieldName>(),
            interfaceObjectFieldNames: new Set<FieldName>(),
            isInterfaceObject: false,
            resolvable: false,
            typeName,
          }));
        }
        visitCompositeOutputDirectiveNodes(nf, definitionNode);
        break;
      }
      case KindRef.OBJECT_TYPE_DEFINITION: {
        if (isObjectLikeNodeEntity(definitionNode)) {
          const typeName = definitionNode.name.value;
          if (isNodeInterfaceObject(definitionNode)) {
            nf.entityInterfaceDataByTypeName.set(typeName, {
              concreteTypeNames: new Set<TypeName>(),
              fieldDatas: [],
              interfaceObjectFieldNames: new Set<FieldName>(),
              interfaceFieldNames: new Set<FieldName>(),
              isInterfaceObject: true,
              resolvable: false,
              typeName,
            });
            nf.internalGraph.addOrUpdateNode(typeName, { isAbstract: true });
          }
          const keyFieldSetDataByFieldSet = getValueOrDefault(
            nf.keyFieldSetDatasByTypeName,
            typeName,
            () => new Map<string, KeyFieldSetData>(),
          );
          nf.extractKeyFieldSets(definitionNode, keyFieldSetDataByFieldSet);
          upsertEntityData({
            entityDataByTypeName: nf.entityDataByTypeName,
            keyFieldSetDataByFieldSet,
            subgraphName: nf.subgraphName,
            typeName,
          });
        }
        visitCompositeOutputDirectiveNodes(nf, definitionNode);
        break;
      }
      case KindRef.OBJECT_TYPE_EXTENSION: {
        if (isObjectLikeNodeEntity(definitionNode)) {
          const typeName = definitionNode.name.value;
          const keyFieldSetDataByFieldSet = getValueOrDefault(
            nf.keyFieldSetDatasByTypeName,
            typeName,
            () => new Map<string, KeyFieldSetData>(),
          );
          nf.extractKeyFieldSets(definitionNode, keyFieldSetDataByFieldSet);
          upsertEntityData({
            entityDataByTypeName: nf.entityDataByTypeName,
            keyFieldSetDataByFieldSet,
            subgraphName: nf.subgraphName,
            typeName,
          });
        }
        visitCompositeOutputDirectiveNodes(nf, definitionNode);
        break;
      }
      case KindRef.SCALAR_TYPE_DEFINITION:
      case KindRef.SCALAR_TYPE_EXTENSION:
      case KindRef.UNION_TYPE_DEFINITION:
      case KindRef.UNION_TYPE_EXTENSION: {
        visitDirectiveNodes(nf, definitionNode.directives);
        break;
      }
      case KindRef.SCHEMA_DEFINITION: {
        nf.schemaData.description = definitionNode.description;
        nf.extractDirectives(definitionNode, nf.schemaData.directivesByName);
        visitDirectiveNodes(nf, definitionNode.directives);
        for (const operationTypeNode of definitionNode.operationTypes) {
          visitOperationTypeDefinitionNode(nf, operationTypeNode);
        }
        break;
      }
      case KindRef.SCHEMA_EXTENSION: {
        nf.extractDirectives(definitionNode, nf.schemaData.directivesByName);
        visitDirectiveNodes(nf, definitionNode.directives);
        if (definitionNode.operationTypes) {
          for (const operationTypeNode of definitionNode.operationTypes) {
            visitOperationTypeDefinitionNode(nf, operationTypeNode);
          }
        }
        break;
      }
      default: {
        // Executable definitions; visit() is retained to collect any nested directive usages.
        visit(definitionNode, {
          Directive: {
            enter(node) {
              visitDirectiveNode(nf, node);
              return false;
            },
          },
        });
      }
    }
  }
}

function visitEnumValueDefinitionNode(nf: NormalizationFactory, node: EnumValueDefinitionNode) {
  enterEnumValueDefinitionNode(nf, node);
  nf.lastChildNodeKind = KindRef.NULL;
}

function enterEnumValueDefinitionNode(nf: NormalizationFactory, node: EnumValueDefinitionNode) {
  const name = node.name.value;
  nf.lastChildNodeKind = node.kind;
  const parentData = getOrThrowError(
    nf.parentDefinitionDataByTypeName,
    nf.originalParentTypeName,
    PARENT_DEFINITION_DATA,
  );
  if (parentData.kind !== KindRef.ENUM_TYPE_DEFINITION) {
    nf.errors.push(
      unexpectedParentKindForChildError(
        nf.originalParentTypeName,
        'Enum or Enum extension',
        kindToNodeType(parentData.kind),
        name,
        kindToNodeType(node.kind),
      ),
    );
    return;
  }
  if (parentData.enumValueDataByName.has(name)) {
    nf.errors.push(duplicateEnumValueDefinitionError(nf.originalParentTypeName, name));
    return;
  }
  const description = formatDescription(node.description);
  parentData.enumValueDataByName.set(name, {
    appearances: 1,
    // Lazily allocated upon first write to retain a stable object shape.
    configureDescriptionDataBySubgraphName: undefined,
    directivesByName: nf.extractDirectives(node, new CompactMap<string, ConstDirectiveNode[]>()),
    federatedCoords: `${nf.originalParentTypeName}.${name}`,
    kind: KindRef.ENUM_VALUE_DEFINITION,
    name,
    node: getMutableEnumValueNode(node, description),
    parentTypeName: nf.originalParentTypeName,
    federatedDirectivesData: newFederatedDirectivesData(),
    subgraphNames: new CompactSet(nf.subgraphName),
    description,
  });
}

function visitFieldDefinitionNode(
  nf: NormalizationFactory,
  node: FieldDefinitionNode,
  isParentRootType: boolean,
  currentParentNode: RootNode | GraphNode | undefined,
) {
  if (!enterFieldDefinitionNode(nf, node, isParentRootType, currentParentNode)) {
    return;
  }
  if (node.arguments) {
    for (const inputValueNode of node.arguments) {
      visitInputValueDefinitionNode(nf, inputValueNode);
    }
  }
  nf.lastChildNodeKind = KindRef.NULL;
}

// Returns false if the node's children and "leave" logic should be skipped.
function enterFieldDefinitionNode(
  nf: NormalizationFactory,
  node: FieldDefinitionNode,
  isParentRootType: boolean,
  currentParentNode: RootNode | GraphNode | undefined,
): boolean {
  const fieldName = node.name.value;
  if (isParentRootType && IGNORED_FIELDS.has(fieldName)) {
    // _entities and _service
    return false;
  }
  const hasDirectives = !!node.directives?.length;
  // subscriptionFilter is temporarily an EDFS-only feature
  if (hasDirectives && nf.edfsDirectiveReferences.size > 0) {
    nf.validateSubscriptionFilterDirectiveLocation(node);
  }
  nf.lastChildNodeKind = node.kind;
  const fieldNamedTypeName = getTypeNodeNamedTypeName(node.type);
  let fieldCoords = nf.fieldCoordsByNamedTypeName.get(fieldNamedTypeName);
  if (!fieldCoords) {
    fieldCoords = new Set<string>();
    nf.fieldCoordsByNamedTypeName.set(fieldNamedTypeName, fieldCoords);
  }
  const parentTypeName = nf.renamedParentTypeName || nf.originalParentTypeName;
  fieldCoords.add(`${parentTypeName}.${fieldName}`);
  // The edges of interface nodes are their concrete types, so fields are not added
  if (currentParentNode && !currentParentNode.isAbstract) {
    nf.internalGraph.addEdge(currentParentNode, nf.internalGraph.addOrUpdateNode(fieldNamedTypeName), fieldName);
  }
  if (!BASE_SCALARS.has(fieldNamedTypeName)) {
    nf.referencedTypeNames.add(fieldNamedTypeName);
  }
  const parentData = getOrThrowError(
    nf.parentDefinitionDataByTypeName,
    nf.originalParentTypeName,
    PARENT_DEFINITION_DATA,
  );
  if (!isParentDataCompositeOutputType(parentData)) {
    nf.errors.push(
      unexpectedParentKindForChildError(
        nf.originalParentTypeName,
        '"Object" or "Interface"',
        kindToNodeType(parentData.kind),
        fieldName,
        kindToNodeType(node.kind),
      ),
    );
    return true;
  }
  if (parentData.fieldDataByName.has(fieldName)) {
    nf.errors.push(duplicateFieldDefinitionError(kindToNodeType(parentData.kind), parentData.name, fieldName));
    return true;
  }
  const argumentDataByName = node.arguments?.length
    ? nf.extractArguments(new CompactMap<string, InputValueData>(), node)
    : undefined;
  const directivesByName = hasDirectives
    ? nf.extractDirectives(node, new CompactMap<string, ConstDirectiveNode[]>())
    : new CompactMap<string, ConstDirectiveNode[]>();
  const inheritedDirectiveNames =
    hasDirectives || nf.doesParentRequireFetchReasons || nf.isParentObjectExternal || nf.isParentObjectShareable
      ? nf.handleFieldInheritableDirectives({
          directivesByName: directivesByName,
          fieldName,
          parentData,
        })
      : undefined;
  const fieldData = nf.addFieldDataByNode(
    parentData.fieldDataByName,
    node,
    argumentDataByName,
    directivesByName,
    inheritedDirectiveNames,
  );
  if (isParentRootType) {
    nf.extractEventDirectivesToConfiguration(node, argumentDataByName ?? new CompactMap<string, InputValueData>());
  }
  const providesDirectives = fieldData.directivesByName.get(PROVIDES);
  const requiresDirectives = fieldData.directivesByName.get(REQUIRES);
  // return early to avoid creating unnecessary FieldSetDatas
  if (!requiresDirectives && !providesDirectives) {
    return true;
  }
  const entityData = nf.entityDataByTypeName.get(nf.originalParentTypeName);
  const fieldSetData = getValueOrDefault(nf.fieldSetDataByTypeName, nf.originalParentTypeName, newFieldSetData);
  if (providesDirectives) {
    extractFieldSetValue(fieldName, fieldSetData.provides, providesDirectives);
  }
  if (requiresDirectives) {
    if (!entityData) {
      // @TODO @requires can only be satisfied if the host Field parent is an Entity
      nf.warnings.push(
        requiresDefinedOnNonEntityFieldWarning(`${nf.originalParentTypeName}.${fieldName}`, nf.subgraphName),
      );
    }
    extractFieldSetValue(fieldName, fieldSetData.requires, requiresDirectives);
  }
  return true;
}

function visitInputValueDefinitionNode(nf: NormalizationFactory, node: InputValueDefinitionNode) {
  if (!enterInputValueDefinitionNode(nf, node)) {
    return;
  }
  nf.argumentName = '';
  // Only reset childName and lastNodeKind if this input value was NOT an argument
  if (nf.lastChildNodeKind === KindRef.INPUT_VALUE_DEFINITION) {
    nf.lastChildNodeKind = KindRef.NULL;
  }
}

// Returns false if the node's children and "leave" logic should be skipped.
function enterInputValueDefinitionNode(nf: NormalizationFactory, node: InputValueDefinitionNode): boolean {
  const name = node.name.value;
  // If the parent is not an object type definition/extension, this node is an argument
  if (
    nf.lastParentNodeKind !== KindRef.INPUT_OBJECT_TYPE_DEFINITION &&
    nf.lastParentNodeKind !== KindRef.INPUT_OBJECT_TYPE_EXTENSION
  ) {
    nf.argumentName = name;
    return true;
  }
  nf.lastChildNodeKind = node.kind;
  const namedInputValueTypeName = getTypeNodeNamedTypeName(node.type);
  if (!BASE_SCALARS.has(namedInputValueTypeName)) {
    nf.referencedTypeNames.add(namedInputValueTypeName);
  }
  const parentData = getOrThrowError(
    nf.parentDefinitionDataByTypeName,
    nf.originalParentTypeName,
    PARENT_DEFINITION_DATA,
  );
  if (parentData.kind !== KindRef.INPUT_OBJECT_TYPE_DEFINITION) {
    nf.errors.push(
      unexpectedParentKindForChildError(
        nf.originalParentTypeName,
        'input object or input object extension',
        kindToNodeType(parentData.kind),
        name,
        kindToNodeType(node.kind),
      ),
    );
    return false;
  }
  if (parentData.inputValueDataByName.has(name)) {
    nf.errors.push(duplicateInputFieldDefinitionError(nf.originalParentTypeName, name));
    return true;
  }
  nf.addInputValueDataByNode({
    inputValueDataByName: parentData.inputValueDataByName,
    isArgument: false,
    node,
    originalParentTypeName: nf.originalParentTypeName,
  });
  return true;
}

export function upsertParentsAndChildren(nf: NormalizationFactory, document: DocumentNode) {
  let isParentRootType = false;
  let currentParentNode: RootNode | GraphNode | undefined;
  for (const definitionNode of document.definitions) {
    switch (definitionNode.kind) {
      case KindRef.DIRECTIVE_DEFINITION: {
        // The definition's arguments propagate the same state lifecycle as field arguments.
        if (definitionNode.arguments) {
          for (const inputValueNode of definitionNode.arguments) {
            visitInputValueDefinitionNode(nf, inputValueNode);
          }
        }
        break;
      }
      case KindRef.ENUM_TYPE_DEFINITION: {
        nf.originalParentTypeName = definitionNode.name.value;
        nf.lastParentNodeKind = definitionNode.kind;
        nf.upsertEnumDataByNode(definitionNode);
        if (definitionNode.values) {
          for (const enumValueNode of definitionNode.values) {
            visitEnumValueDefinitionNode(nf, enumValueNode);
          }
        }
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = KindRef.NULL;
        break;
      }
      case KindRef.ENUM_TYPE_EXTENSION: {
        nf.originalParentTypeName = definitionNode.name.value;
        nf.lastParentNodeKind = definitionNode.kind;
        nf.upsertEnumDataByNode(definitionNode, true);
        if (definitionNode.values) {
          for (const enumValueNode of definitionNode.values) {
            visitEnumValueDefinitionNode(nf, enumValueNode);
          }
        }
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = KindRef.NULL;
        break;
      }
      case KindRef.INPUT_OBJECT_TYPE_DEFINITION: {
        nf.originalParentTypeName = definitionNode.name.value;
        nf.lastParentNodeKind = definitionNode.kind;
        nf.upsertInputObjectByNode(definitionNode);
        if (definitionNode.fields) {
          for (const inputValueNode of definitionNode.fields) {
            visitInputValueDefinitionNode(nf, inputValueNode);
          }
        }
        nf.lastParentNodeKind = KindRef.NULL;
        nf.originalParentTypeName = '';
        break;
      }
      case KindRef.INPUT_OBJECT_TYPE_EXTENSION: {
        nf.originalParentTypeName = definitionNode.name.value;
        nf.lastParentNodeKind = definitionNode.kind;
        nf.upsertInputObjectByNode(definitionNode, true);
        if (definitionNode.fields) {
          for (const inputValueNode of definitionNode.fields) {
            visitInputValueDefinitionNode(nf, inputValueNode);
          }
        }
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = KindRef.NULL;
        break;
      }
      case KindRef.INTERFACE_TYPE_DEFINITION: {
        nf.originalParentTypeName = definitionNode.name.value;
        nf.lastParentNodeKind = definitionNode.kind;
        nf.upsertInterfaceDataByNode(definitionNode);
        if (definitionNode.fields) {
          for (const fieldNode of definitionNode.fields) {
            visitFieldDefinitionNode(nf, fieldNode, isParentRootType, currentParentNode);
          }
        }
        nf.doesParentRequireFetchReasons = false;
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = KindRef.NULL;
        break;
      }
      case KindRef.INTERFACE_TYPE_EXTENSION: {
        nf.originalParentTypeName = definitionNode.name.value;
        nf.lastParentNodeKind = definitionNode.kind;
        nf.upsertInterfaceDataByNode(definitionNode, true);
        if (definitionNode.fields) {
          for (const fieldNode of definitionNode.fields) {
            visitFieldDefinitionNode(nf, fieldNode, isParentRootType, currentParentNode);
          }
        }
        nf.doesParentRequireFetchReasons = false;
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = KindRef.NULL;
        break;
      }
      case KindRef.OBJECT_TYPE_DEFINITION: {
        if (definitionNode.name.value === SERVICE_OBJECT) {
          break;
        }
        nf.originalParentTypeName = definitionNode.name.value;
        isParentRootType = isTypeNameRootType(nf.originalParentTypeName, nf.operationTypeNodeByTypeName);
        nf.renamedParentTypeName = getRenamedRootTypeName(nf.originalParentTypeName, nf.operationTypeNodeByTypeName);
        nf.originalTypeNameByRenamedTypeName.set(nf.renamedParentTypeName, nf.originalParentTypeName);
        currentParentNode = isParentRootType
          ? nf.internalGraph.getRootNode(nf.renamedParentTypeName as RootTypeName)
          : nf.internalGraph.addOrUpdateNode(nf.renamedParentTypeName);
        nf.lastParentNodeKind = definitionNode.kind;
        nf.upsertObjectDataByNode(definitionNode);
        if (definitionNode.fields) {
          for (const fieldNode of definitionNode.fields) {
            visitFieldDefinitionNode(nf, fieldNode, isParentRootType, currentParentNode);
          }
        }
        currentParentNode = undefined;
        isParentRootType = false;
        nf.originalParentTypeName = '';
        nf.renamedParentTypeName = '';
        nf.lastParentNodeKind = KindRef.NULL;
        nf.isParentObjectExternal = false;
        nf.doesParentRequireFetchReasons = false;
        nf.isParentObjectShareable = false;
        break;
      }
      case KindRef.OBJECT_TYPE_EXTENSION: {
        if (definitionNode.name.value === SERVICE_OBJECT) {
          break;
        }
        nf.originalParentTypeName = definitionNode.name.value;
        isParentRootType = isTypeNameRootType(nf.originalParentTypeName, nf.operationTypeNodeByTypeName);
        nf.renamedParentTypeName = getRenamedRootTypeName(nf.originalParentTypeName, nf.operationTypeNodeByTypeName);
        nf.originalTypeNameByRenamedTypeName.set(nf.renamedParentTypeName, nf.originalParentTypeName);
        currentParentNode = isParentRootType
          ? nf.internalGraph.getRootNode(nf.renamedParentTypeName as RootTypeName)
          : nf.internalGraph.addOrUpdateNode(nf.renamedParentTypeName);
        nf.lastParentNodeKind = definitionNode.kind;
        nf.upsertObjectDataByNode(definitionNode, true);
        if (definitionNode.fields) {
          for (const fieldNode of definitionNode.fields) {
            visitFieldDefinitionNode(nf, fieldNode, isParentRootType, currentParentNode);
          }
        }
        currentParentNode = undefined;
        isParentRootType = false;
        nf.originalParentTypeName = '';
        nf.renamedParentTypeName = '';
        nf.lastParentNodeKind = KindRef.NULL;
        nf.isParentObjectExternal = false;
        nf.doesParentRequireFetchReasons = false;
        nf.isParentObjectShareable = false;
        break;
      }
      case KindRef.SCALAR_TYPE_DEFINITION: {
        if (definitionNode.name.value === ANY_SCALAR) {
          break;
        }
        nf.originalParentTypeName = definitionNode.name.value;
        nf.lastParentNodeKind = definitionNode.kind;
        nf.upsertScalarByNode(definitionNode);
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = KindRef.NULL;
        break;
      }
      case KindRef.SCALAR_TYPE_EXTENSION: {
        if (definitionNode.name.value === ANY_SCALAR) {
          break;
        }
        nf.originalParentTypeName = definitionNode.name.value;
        nf.lastParentNodeKind = definitionNode.kind;
        nf.upsertScalarByNode(definitionNode, true);
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = KindRef.NULL;
        break;
      }
      case KindRef.UNION_TYPE_DEFINITION: {
        if (definitionNode.name.value === ENTITY_UNION) {
          break;
        }
        nf.upsertUnionByNode(definitionNode);
        break;
      }
      case KindRef.UNION_TYPE_EXTENSION: {
        if (definitionNode.name.value === ENTITY_UNION) {
          break;
        }
        nf.upsertUnionByNode(definitionNode, true);
        break;
      }
    }
  }
}
