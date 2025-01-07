import { ConstDirectiveNode, DocumentNode, Kind, visit } from 'graphql';
import {
  duplicateDirectiveDefinitionError,
  duplicateEnumValueDefinitionError,
  duplicateFieldDefinitionError,
  duplicateInputFieldDefinitionError,
  duplicateOperationTypeDefinitionError,
  invalidOperationTypeDefinitionError,
  unexpectedParentKindForChildError,
} from '../errors/errors';
import { NormalizationFactory } from './normalization-factory';
import {
  BASE_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME,
  BASE_SCALARS,
  SUBSCRIPTION_FILTER_DEFINITION,
  V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME,
} from '../utils/constants';
import {
  AuthorizationData,
  getOrThrowError,
  getValueOrDefault,
  kindToTypeString,
  mergeAuthorizationDataByAND,
  newAuthorizationData,
  newFieldAuthorizationData,
  setAndGetValue,
  upsertEntityDataProperties,
} from '../utils/utils';
import { isNodeInterfaceObject, isObjectLikeNodeEntity, SchemaNode } from '../ast/utils';
import { extractFieldSetValue, newFieldSetData, newKeyFieldSetData } from './utils';
import {
  ANY_SCALAR,
  ENTITIES_FIELD,
  ENTITY_UNION,
  EVENT_DIRECTIVE_NAMES,
  EXTERNAL,
  PARENT_DEFINITION_DATA,
  PROVIDES,
  REQUIRES,
  RootTypeName,
  SCHEMA,
  SERVICE_FIELD,
  SERVICE_OBJECT,
  SUBSCRIPTION_FILTER,
} from '../utils/string-constants';
import {
  addEnumValueDataByNode,
  addFieldDataByNode,
  addInheritedDirectivesToFieldData,
  addInputValueDataByNode,
  extractArguments,
  extractDirectives,
  getRenamedRootTypeName,
  isParentDataInterfaceType,
  isTypeNameRootType,
  removeInheritableDirectivesFromParentWithFieldsData,
} from '../schema-building/utils';
import { InputValueData, ObjectDefinitionData } from '../schema-building/type-definition-data';
import { getTypeNodeNamedTypeName } from '../schema-building/ast';
import { GraphNode, RootNode } from '../resolvability-graph/graph-nodes';
import { requiresDefinedOnNonEntityFieldWarning } from '../warnings/warnings';

// Walker to collect schema definition, directive definitions, and entities
export function upsertDirectiveSchemaAndEntityDefinitions(nf: NormalizationFactory, document: DocumentNode) {
  const definedDirectives = new Set<string>();
  const schemaNodes: SchemaNode[] = [];
  visit(document, {
    Directive: {
      enter(node) {
        const name = node.name.value;
        if (EVENT_DIRECTIVE_NAMES.has(name)) {
          nf.edfsDirectiveReferences.add(name);
        }
        if (V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME.has(name)) {
          nf.isSubgraphVersionTwo = true;
          return false;
        }
        if (BASE_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME.has(name)) {
          return false;
        }
        if (name === SUBSCRIPTION_FILTER) {
          nf.directiveDefinitionByDirectiveName.set(SUBSCRIPTION_FILTER, SUBSCRIPTION_FILTER_DEFINITION);
        }
        nf.referencedDirectiveNames.add(name);
      },
    },
    DirectiveDefinition: {
      enter(node) {
        const name = node.name.value;
        if (definedDirectives.has(name)) {
          nf.errors.push(duplicateDirectiveDefinitionError(name));
          return false;
        }
        definedDirectives.add(name);
        // Normalize federation directives by replacing them with predefined definitions
        if (V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME.has(name)) {
          nf.isSubgraphVersionTwo = true;
          return false;
        }
        // The V1 directives are always injected
        if (BASE_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME.has(name)) {
          return false;
        }
        if (name === SUBSCRIPTION_FILTER) {
          return false;
        }
        nf.directiveDefinitionByDirectiveName.set(name, node);
        nf.customDirectiveDefinitions.set(name, node);
        return false;
      },
    },
    InterfaceTypeDefinition: {
      enter(node) {
        const typeName = node.name.value;
        nf.internalGraph.addOrUpdateNode(typeName, { isAbstract: true });
        if (!isObjectLikeNodeEntity(node)) {
          return;
        }
        const keyFieldSetData = getValueOrDefault(nf.keyFieldSetDataByTypeName, typeName, newKeyFieldSetData);
        nf.extractKeyFieldSets(node, keyFieldSetData);
        upsertEntityDataProperties(nf.entityDataByTypeName, {
          typeName,
          keyFieldSets: keyFieldSetData.isUnresolvableByKeyFieldSet.keys(),
          ...(nf.subgraphName ? { subgraphNames: [nf.subgraphName] } : {}),
        });
        getValueOrDefault(nf.entityInterfaceDataByTypeName, typeName, () => ({
          concreteTypeNames: new Set<string>(),
          fieldDatas: [],
          interfaceFieldNames: new Set<string>(),
          interfaceObjectFieldNames: new Set<string>(),
          isInterfaceObject: false,
          typeName,
        }));
      },
    },
    InterfaceTypeExtension: {
      enter(node) {
        const typeName = node.name.value;
        nf.internalGraph.addOrUpdateNode(typeName, { isAbstract: true });
        if (!isObjectLikeNodeEntity(node)) {
          return;
        }
        const keyFieldSetData = getValueOrDefault(nf.keyFieldSetDataByTypeName, typeName, newKeyFieldSetData);
        nf.extractKeyFieldSets(node, keyFieldSetData);
        upsertEntityDataProperties(nf.entityDataByTypeName, {
          typeName,
          keyFieldSets: keyFieldSetData.isUnresolvableByKeyFieldSet.keys(),
          ...(nf.subgraphName ? { subgraphNames: [nf.subgraphName] } : {}),
        });
      },
    },
    ObjectTypeDefinition: {
      enter(node) {
        if (!isObjectLikeNodeEntity(node)) {
          return;
        }
        const typeName = node.name.value;
        if (isNodeInterfaceObject(node)) {
          nf.entityInterfaceDataByTypeName.set(typeName, {
            fieldDatas: [],
            interfaceObjectFieldNames: new Set<string>(),
            interfaceFieldNames: new Set<string>(),
            isInterfaceObject: true,
            typeName,
          });
          nf.internalGraph.addOrUpdateNode(typeName, { isAbstract: true });
        }
        const keyFieldSetData = getValueOrDefault(nf.keyFieldSetDataByTypeName, typeName, newKeyFieldSetData);
        nf.extractKeyFieldSets(node, keyFieldSetData);
        upsertEntityDataProperties(nf.entityDataByTypeName, {
          typeName,
          keyFieldSets: keyFieldSetData.isUnresolvableByKeyFieldSet.keys(),
          ...(nf.subgraphName ? { subgraphNames: [nf.subgraphName] } : {}),
        });
      },
    },
    ObjectTypeExtension: {
      enter(node) {
        if (!isObjectLikeNodeEntity(node)) {
          return;
        }
        const typeName = node.name.value;
        const keyFieldSetData = getValueOrDefault(nf.keyFieldSetDataByTypeName, typeName, newKeyFieldSetData);
        nf.extractKeyFieldSets(node, keyFieldSetData);
        upsertEntityDataProperties(nf.entityDataByTypeName, {
          typeName,
          keyFieldSets: keyFieldSetData.isUnresolvableByKeyFieldSet.keys(),
          ...(nf.subgraphName ? { subgraphNames: [nf.subgraphName] } : {}),
        });
      },
    },
    OperationTypeDefinition: {
      enter(node) {
        const operationType = node.operation;
        const definitionNode = nf.schemaDefinition.operationTypes.get(operationType);
        const namedTypeName = getTypeNodeNamedTypeName(node.type);
        if (definitionNode) {
          duplicateOperationTypeDefinitionError(
            operationType,
            namedTypeName,
            getTypeNodeNamedTypeName(definitionNode.type),
          );
          return false;
        }
        const existingOperationType = nf.operationTypeNodeByTypeName.get(namedTypeName);
        if (existingOperationType) {
          nf.errors.push(invalidOperationTypeDefinitionError(existingOperationType, namedTypeName, operationType));
          return false;
        }
        nf.operationTypeNodeByTypeName.set(namedTypeName, operationType);
        nf.schemaDefinition.operationTypes.set(operationType, node);
        return false;
      },
    },
    SchemaDefinition: {
      enter(node) {
        schemaNodes.push(node);
        nf.schemaDefinition.description = node.description;
      },
    },
    SchemaExtension: {
      enter(node) {
        schemaNodes.push(node);
      },
    },
    UnionTypeDefinition: {
      enter(node) {
        if (node.name.value === ENTITY_UNION) {
          return;
        }
        nf.upsertUnionByNode(node);
      },
    },
    UnionTypeExtension: {
      enter(node) {
        if (node.name.value === ENTITY_UNION) {
          return false;
        }
        nf.upsertUnionByNode(node, true);
      },
    },
  });
  /* It is possible that directives definitions are defined in the schema after the schema nodes that declare those
   * directives have been defined. Consequently, the directives can  only be validated after the walker has finished
   * collecting all directive definitions. */
  for (const node of schemaNodes) {
    extractDirectives(
      node,
      nf.schemaDefinition.directivesByDirectiveName,
      nf.errors,
      nf.directiveDefinitionByDirectiveName,
      nf.handledRepeatedDirectivesByHostPath,
      SCHEMA,
    );
  }
}

export function upsertParentsAndChildren(nf: NormalizationFactory, document: DocumentNode) {
  let isParentRootType = false;
  let currentParentNode: RootNode | GraphNode | undefined;
  visit(document, {
    EnumTypeDefinition: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        nf.lastParentNodeKind = node.kind;
        nf.upsertEnumDataByNode(node);
      },
      leave() {
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    EnumTypeExtension: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        nf.lastParentNodeKind = node.kind;
        nf.upsertEnumDataByNode(node, true);
      },
      leave() {
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    EnumValueDefinition: {
      enter(node) {
        nf.childName = node.name.value;
        nf.lastChildNodeKind = node.kind;
        const parentData = getOrThrowError(
          nf.parentDefinitionDataByTypeName,
          nf.originalParentTypeName,
          PARENT_DEFINITION_DATA,
        );
        if (parentData.kind !== Kind.ENUM_TYPE_DEFINITION) {
          nf.errors.push(
            unexpectedParentKindForChildError(
              nf.originalParentTypeName,
              'enum or enum extension',
              kindToTypeString(parentData.kind),
              nf.childName,
              kindToTypeString(node.kind),
            ),
          );
          return;
        }
        if (parentData.enumValueDataByValueName.has(nf.childName)) {
          nf.errors.push(duplicateEnumValueDefinitionError(nf.originalParentTypeName, nf.childName));
          return;
        }
        addEnumValueDataByNode(
          parentData.enumValueDataByValueName,
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          nf.originalParentTypeName,
          nf.subgraphName,
        );
      },
      leave() {
        nf.childName = '';
        nf.lastChildNodeKind = Kind.NULL;
      },
    },
    FieldDefinition: {
      enter(node) {
        nf.childName = node.name.value;
        if (isParentRootType) {
          if (nf.childName === SERVICE_FIELD || nf.childName === ENTITIES_FIELD) {
            return false;
          }
        }
        // subscriptionFilter is temporarily an EDFS-only feature
        if (nf.edfsDirectiveReferences.size > 0) {
          nf.validateSubscriptionFilterDirectiveLocation(node);
        }
        nf.lastChildNodeKind = node.kind;
        const fieldNamedTypeName = getTypeNodeNamedTypeName(node.type);
        // The edges of interface nodes are their concrete types, so fields are not added
        if (currentParentNode && !currentParentNode.isAbstract) {
          nf.internalGraph.addEdge(
            currentParentNode,
            nf.internalGraph.addOrUpdateNode(fieldNamedTypeName),
            nf.childName,
          );
        }
        if (!BASE_SCALARS.has(fieldNamedTypeName)) {
          nf.referencedTypeNames.add(fieldNamedTypeName);
        }
        const parentData = getOrThrowError(
          nf.parentDefinitionDataByTypeName,
          nf.originalParentTypeName,
          PARENT_DEFINITION_DATA,
        );
        if (parentData.kind !== Kind.OBJECT_TYPE_DEFINITION && parentData.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
          nf.errors.push(
            unexpectedParentKindForChildError(
              nf.originalParentTypeName,
              '"Object" or "Interface"',
              kindToTypeString(parentData.kind),
              nf.childName,
              kindToTypeString(node.kind),
            ),
          );
          return;
        }
        if (parentData.fieldDataByFieldName.has(nf.childName)) {
          nf.errors.push(
            duplicateFieldDefinitionError(kindToTypeString(parentData.kind), parentData.name, nf.childName),
          );
          return;
        }
        const argumentDataByArgumentName = extractArguments(
          new Map<string, InputValueData>(),
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          nf.parentsWithChildArguments,
          nf.originalParentTypeName,
          nf.renamedParentTypeName || nf.originalParentTypeName,
          nf.subgraphName,
        );
        const directivesByDirectiveName = nf.extractDirectivesAndAuthorization(
          node,
          new Map<string, ConstDirectiveNode[]>(),
        );
        // Add parent-level shareable and external to the field extraction and repeatable validation
        addInheritedDirectivesToFieldData(parentData.directivesByDirectiveName, directivesByDirectiveName);
        const fieldData = addFieldDataByNode(
          parentData.fieldDataByFieldName,
          node,
          argumentDataByArgumentName,
          directivesByDirectiveName,
          nf.originalParentTypeName,
          nf.renamedParentTypeName || nf.originalParentTypeName,
          nf.subgraphName,
          nf.isSubgraphVersionTwo,
          nf.errors,
        );
        if (!isParentDataInterfaceType(parentData) && directivesByDirectiveName.has(EXTERNAL)) {
          nf.unvalidatedExternalFieldCoords.add(`${nf.originalParentTypeName}.${node.name.value}`);
        }
        if (isParentRootType) {
          nf.extractEventDirectivesToConfiguration(node, argumentDataByArgumentName);
        }
        const providesDirectives = fieldData.directivesByDirectiveName.get(PROVIDES);
        const requiresDirectives = fieldData.directivesByDirectiveName.get(REQUIRES);
        // return early to avoid creating unnecessary FieldSetDatas
        if (!requiresDirectives && !providesDirectives) {
          return;
        }
        const entityData = nf.entityDataByTypeName.get(nf.originalParentTypeName);
        const fieldSetData = getValueOrDefault(nf.fieldSetDataByTypeName, nf.originalParentTypeName, newFieldSetData);
        if (entityData) {
          entityData.fieldNames.add(nf.childName);
        }
        if (providesDirectives) {
          extractFieldSetValue(nf.childName, fieldSetData.provides, providesDirectives);
        }
        if (requiresDirectives) {
          if (!entityData) {
            // @TODO @requires can only be satisfied if the host Field parent is an Entity
            nf.warnings.push(
              requiresDefinedOnNonEntityFieldWarning(`${nf.originalParentTypeName}.${nf.childName}`, nf.subgraphName),
            );
          }
          extractFieldSetValue(nf.childName, fieldSetData.requires, requiresDirectives);
        }
      },
      leave() {
        nf.childName = '';
        nf.lastChildNodeKind = Kind.NULL;
      },
    },
    InputObjectTypeDefinition: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        nf.lastParentNodeKind = node.kind;
        nf.upsertInputObjectByNode(node);
      },
      leave() {
        nf.lastParentNodeKind = Kind.NULL;
        nf.originalParentTypeName = '';
      },
    },
    InputObjectTypeExtension: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        nf.lastParentNodeKind = node.kind;
        nf.upsertInputObjectByNode(node, true);
      },
      leave() {
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    InputValueDefinition: {
      enter(node) {
        const name = node.name.value;
        // If the parent is not an object type definition/extension, this node is an argument
        if (
          nf.lastParentNodeKind !== Kind.INPUT_OBJECT_TYPE_DEFINITION &&
          nf.lastParentNodeKind !== Kind.INPUT_OBJECT_TYPE_EXTENSION
        ) {
          nf.argumentName = name;
          return;
        }
        nf.childName = name;
        nf.lastChildNodeKind = node.kind;
        const valuePath = `${nf.originalParentTypeName}.${name}`;
        const namedInputValueTypeName = getTypeNodeNamedTypeName(node.type);
        if (!BASE_SCALARS.has(namedInputValueTypeName)) {
          nf.referencedTypeNames.add(namedInputValueTypeName);
        }
        const parentData = getOrThrowError(
          nf.parentDefinitionDataByTypeName,
          nf.originalParentTypeName,
          PARENT_DEFINITION_DATA,
        );
        if (parentData.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION) {
          nf.errors.push(
            unexpectedParentKindForChildError(
              nf.originalParentTypeName,
              'input object or input object extension',
              kindToTypeString(parentData.kind),
              nf.childName,
              kindToTypeString(node.kind),
            ),
          );
          return false;
        }
        if (parentData.inputValueDataByValueName.has(name)) {
          nf.errors.push(duplicateInputFieldDefinitionError(nf.originalParentTypeName, name));
          return;
        }
        addInputValueDataByNode(
          parentData.inputValueDataByValueName,
          node,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          valuePath,
          nf.subgraphName,
          nf.errors,
        );
      },
      leave() {
        nf.argumentName = '';
        // Only reset childName and lastNodeKind if this input value was NOT an argument
        if (nf.lastChildNodeKind === Kind.INPUT_VALUE_DEFINITION) {
          nf.childName = '';
          nf.lastChildNodeKind = Kind.NULL;
        }
      },
    },
    InterfaceTypeDefinition: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        nf.lastParentNodeKind = node.kind;
        nf.upsertInterfaceDataByNode(node);
      },
      leave() {
        removeInheritableDirectivesFromParentWithFieldsData(
          getOrThrowError(nf.parentDefinitionDataByTypeName, nf.originalParentTypeName, PARENT_DEFINITION_DATA),
        );
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    InterfaceTypeExtension: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        nf.lastParentNodeKind = node.kind;
        nf.upsertInterfaceDataByNode(node, true);
      },
      leave() {
        removeInheritableDirectivesFromParentWithFieldsData(
          getOrThrowError(nf.parentDefinitionDataByTypeName, nf.originalParentTypeName, PARENT_DEFINITION_DATA),
        );
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    ObjectTypeDefinition: {
      enter(node) {
        if (node.name.value === SERVICE_OBJECT) {
          return false;
        }
        nf.originalParentTypeName = node.name.value;
        isParentRootType = isTypeNameRootType(nf.originalParentTypeName, nf.operationTypeNodeByTypeName);
        nf.renamedParentTypeName = getRenamedRootTypeName(nf.originalParentTypeName, nf.operationTypeNodeByTypeName);
        nf.originalTypeNameByRenamedTypeName.set(nf.renamedParentTypeName, nf.originalParentTypeName);
        currentParentNode = isParentRootType
          ? nf.internalGraph.getRootNode(nf.renamedParentTypeName as RootTypeName)
          : nf.internalGraph.addOrUpdateNode(nf.renamedParentTypeName);
        nf.lastParentNodeKind = node.kind;
        nf.upsertObjectDataByNode(node);
      },
      leave() {
        removeInheritableDirectivesFromParentWithFieldsData(
          getOrThrowError(nf.parentDefinitionDataByTypeName, nf.originalParentTypeName, PARENT_DEFINITION_DATA),
        );
        currentParentNode = undefined;
        isParentRootType = false;
        nf.originalParentTypeName = '';
        nf.renamedParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    ObjectTypeExtension: {
      enter(node) {
        if (node.name.value === SERVICE_OBJECT) {
          return false;
        }
        nf.originalParentTypeName = node.name.value;
        isParentRootType = isTypeNameRootType(nf.originalParentTypeName, nf.operationTypeNodeByTypeName);
        nf.renamedParentTypeName = getRenamedRootTypeName(nf.originalParentTypeName, nf.operationTypeNodeByTypeName);
        nf.originalTypeNameByRenamedTypeName.set(nf.renamedParentTypeName, nf.originalParentTypeName);
        currentParentNode = isParentRootType
          ? nf.internalGraph.getRootNode(nf.renamedParentTypeName as RootTypeName)
          : nf.internalGraph.addOrUpdateNode(nf.renamedParentTypeName);
        nf.lastParentNodeKind = node.kind;
        nf.upsertObjectDataByNode(node, true);
      },
      leave() {
        removeInheritableDirectivesFromParentWithFieldsData(
          getOrThrowError(nf.parentDefinitionDataByTypeName, nf.originalParentTypeName, PARENT_DEFINITION_DATA),
        );
        currentParentNode = undefined;
        isParentRootType = false;
        nf.originalParentTypeName = '';
        nf.renamedParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    ScalarTypeDefinition: {
      enter(node) {
        if (node.name.value === ANY_SCALAR) {
          return false;
        }
        nf.originalParentTypeName = node.name.value;
        nf.lastParentNodeKind = node.kind;
        nf.upsertScalarByNode(node);
      },
      leave() {
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    ScalarTypeExtension: {
      enter(node) {
        if (node.name.value === ANY_SCALAR) {
          return false;
        }
        nf.originalParentTypeName = node.name.value;
        nf.lastParentNodeKind = node.kind;
        nf.upsertScalarByNode(node, true);
      },
      leave() {
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
  });
}

// Walker to handle the consolidation of the @authenticated and @requiresScopes directives
export function consolidateAuthorizationDirectives(nf: NormalizationFactory, definitions: DocumentNode) {
  let parentAuthorizationData: AuthorizationData | undefined;
  let isInterfaceKind = false;
  visit(definitions, {
    FieldDefinition: {
      enter(node) {
        nf.childName = node.name.value;
        const typeName = getTypeNodeNamedTypeName(node.type);
        const inheritsAuthorization = nf.leafTypeNamesWithAuthorizationDirectives.has(typeName);
        if (
          (!parentAuthorizationData || !parentAuthorizationData.hasParentLevelAuthorization) &&
          !inheritsAuthorization
        ) {
          return false;
        }
        const parentTypeName = nf.renamedParentTypeName || nf.originalParentTypeName;
        if (!parentAuthorizationData) {
          parentAuthorizationData = setAndGetValue(
            nf.authorizationDataByParentTypeName,
            parentTypeName,
            newAuthorizationData(parentTypeName),
          );
        }
        const fieldAuthorizationData = getValueOrDefault(
          parentAuthorizationData.fieldAuthorizationDataByFieldName,
          nf.childName,
          () => newFieldAuthorizationData(nf.childName),
        );
        if (!mergeAuthorizationDataByAND(parentAuthorizationData, fieldAuthorizationData)) {
          nf.invalidOrScopesHostPaths.add(`${nf.originalParentTypeName}.${nf.childName}`);
          return false;
        }
        if (!inheritsAuthorization) {
          return false;
        }
        if (isInterfaceKind) {
          /* Collect the inherited leaf authorization to apply later. This is to avoid duplication of inherited
             authorization applied to interface and concrete types. */
          getValueOrDefault(nf.heirFieldAuthorizationDataByTypeName, typeName, () => []).push(fieldAuthorizationData);
          return false;
        }
        const definitionAuthorizationData = nf.authorizationDataByParentTypeName.get(typeName);
        if (
          definitionAuthorizationData &&
          definitionAuthorizationData.hasParentLevelAuthorization &&
          !mergeAuthorizationDataByAND(definitionAuthorizationData, fieldAuthorizationData)
        ) {
          nf.invalidOrScopesHostPaths.add(`${nf.originalParentTypeName}.${nf.childName}`);
        }
        return false;
      },
      leave() {
        nf.childName = '';
      },
    },
    InterfaceTypeDefinition: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        parentAuthorizationData = nf.getAuthorizationData(node);
        isInterfaceKind = true;
      },
      leave() {
        nf.originalParentTypeName = '';
        parentAuthorizationData = undefined;
        isInterfaceKind = false;
      },
    },
    InterfaceTypeExtension: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        parentAuthorizationData = nf.getAuthorizationData(node);
        isInterfaceKind = true;
      },
      leave() {
        nf.originalParentTypeName = '';
        parentAuthorizationData = undefined;
        isInterfaceKind = false;
      },
    },
    ObjectTypeDefinition: {
      enter(node) {
        const parentData = nf.parentDefinitionDataByTypeName.get(node.name.value);
        if (!parentData) {
          return false;
        }
        nf.originalParentTypeName = parentData.name;
        nf.renamedParentTypeName = (parentData as ObjectDefinitionData).renamedTypeName;
        parentAuthorizationData = nf.getAuthorizationData(node);
      },
      leave() {
        nf.originalParentTypeName = '';
        nf.renamedParentTypeName = '';
        parentAuthorizationData = undefined;
      },
    },
    ObjectTypeExtension: {
      enter(node) {
        const parentData = nf.parentDefinitionDataByTypeName.get(node.name.value);
        if (!parentData) {
          return false;
        }
        nf.originalParentTypeName = parentData.name;
        nf.renamedParentTypeName = (parentData as ObjectDefinitionData).renamedTypeName;
        parentAuthorizationData = nf.getAuthorizationData(node);
      },
      leave() {
        nf.originalParentTypeName = '';
        nf.renamedParentTypeName = '';
        parentAuthorizationData = undefined;
      },
    },
  });
}
