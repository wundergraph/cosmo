import { ConstDirectiveNode, DocumentNode, Kind, visit } from 'graphql';
import {
  duplicateDirectiveDefinitionError,
  duplicateEnumValueDefinitionError,
  duplicateFieldDefinitionError,
  duplicateOperationTypeDefinitionError,
  duplicateTypeDefinitionError,
  duplicateValueExtensionError,
  incompatibleExtensionKindsError,
  invalidOperationTypeDefinitionError,
  noDefinedUnionMembersError,
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
import { isNodeExtension, isNodeInterfaceObject, isObjectLikeNodeEntity, SchemaNode } from '../ast/utils';
import { extractFieldSetValue, newFieldSetData } from './utils';
import {
  ANY_SCALAR,
  ENTITIES_FIELD,
  ENTITY_UNION,
  EVENT_DIRECTIVE_NAMES,
  EXTENSIONS,
  N_A,
  PARENT_DEFINITION_DATA,
  PARENT_DEFINITION_DATA_MAP,
  PARENT_EXTENSION_DATA_MAP,
  PROVIDES,
  REQUIRES,
  RootTypeName,
  SCHEMA,
  SERVICE_FIELD,
  SERVICE_OBJECT,
  SUBSCRIPTION_FILTER,
} from '../utils/string-constants';
import {
  addEnumDefinitionDataByNode,
  addEnumExtensionDataByNode,
  addEnumValueDataByNode,
  addFieldDataByNode,
  addInheritedDirectivesToFieldData,
  addInputObjectDefinitionDataByNode,
  addInputObjectExtensionDataByNode,
  addInputValueDataByNode,
  addInterfaceDefinitionDataByNode,
  addObjectDefinitionDataByNode,
  addScalarDefinitionDataByNode,
  addScalarExtensionDataByNode,
  addUnionDefinitionDataByNode,
  addUnionExtensionDataByNode,
  extractArguments,
  extractDirectives,
  extractUniqueUnionMembers,
  getRenamedRootTypeName,
  isTypeNameRootType,
  ObjectData,
  removeInheritableDirectivesFromParentWithFieldsData,
} from '../schema-building/utils';
import { InputValueData } from '../schema-building/type-definition-data';
import { getTypeNodeNamedTypeName } from '../schema-building/ast';
import { GraphNode, RootNode } from '../resolvability-graph/graph-nodes';

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
        const fieldSetData = getValueOrDefault(nf.fieldSetDataByTypeName, typeName, newFieldSetData);
        nf.extractKeyFieldSets(node, fieldSetData);
        upsertEntityDataProperties(nf.entityDataByTypeName, {
          typeName,
          keyFieldSets: fieldSetData.isUnresolvableByKeyFieldSet.keys(),
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
        if (!isObjectLikeNodeEntity(node)) {
          return;
        }
        const typeName = node.name.value;
        const fieldSetData = getValueOrDefault(nf.fieldSetDataByTypeName, typeName, newFieldSetData);
        nf.extractKeyFieldSets(node, fieldSetData);
        upsertEntityDataProperties(nf.entityDataByTypeName, {
          typeName,
          keyFieldSets: fieldSetData.isUnresolvableByKeyFieldSet.keys(),
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
          nf.internalGraph.addOrUpdateNode(typeName, { isAbstract: true });
        }
        const fieldSetData = getValueOrDefault(nf.fieldSetDataByTypeName, typeName, newFieldSetData);
        nf.extractKeyFieldSets(node, fieldSetData);
        upsertEntityDataProperties(nf.entityDataByTypeName, {
          typeName,
          keyFieldSets: fieldSetData.isUnresolvableByKeyFieldSet.keys(),
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
        const fieldSetData = getValueOrDefault(nf.fieldSetDataByTypeName, typeName, newFieldSetData);
        nf.extractKeyFieldSets(node, fieldSetData);
        upsertEntityDataProperties(nf.entityDataByTypeName, {
          typeName,
          keyFieldSets: fieldSetData.isUnresolvableByKeyFieldSet.keys(),
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
        const typeName = node.name.value;
        if (typeName === ENTITY_UNION) {
          return false;
        }
        // Also adds concrete types to the internal graph
        nf.addConcreteTypesForUnion(node);
        if (nf.parentDefinitionDataByTypeName.has(typeName)) {
          nf.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), typeName));
          return false;
        }
        addUnionDefinitionDataByNode(
          nf.parentDefinitionDataByTypeName,
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          nf.concreteTypeNamesByAbstractTypeName,
          nf.referencedTypeNames,
        );
      },
    },
    UnionTypeExtension: {
      enter(node) {
        const typeName = node.name.value;
        if (typeName === ENTITY_UNION) {
          return false;
        }
        const extension = nf.parentExtensionDataByTypeName.get(typeName);
        if (!node.types?.length) {
          nf.errors.push(noDefinedUnionMembersError(typeName, true));
          return false;
        }
        // Also adds concrete types to the internal graph
        nf.addConcreteTypesForUnion(node);
        if (extension) {
          if (extension.kind !== Kind.UNION_TYPE_EXTENSION) {
            nf.errors.push(incompatibleExtensionKindsError(node, extension.kind));
            return false;
          }
          extractDirectives(
            node,
            extension.directivesByDirectiveName,
            nf.errors,
            nf.directiveDefinitionByDirectiveName,
            nf.handledRepeatedDirectivesByHostPath,
            typeName,
          );
          extractUniqueUnionMembers(
            node.types,
            extension.memberByMemberTypeName,
            nf.errors,
            typeName,
            nf.concreteTypeNamesByAbstractTypeName,
            nf.referencedTypeNames,
          );
          return false;
        }
        addUnionExtensionDataByNode(
          nf.parentExtensionDataByTypeName,
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          nf.concreteTypeNamesByAbstractTypeName,
          nf.referencedTypeNames,
        );
        return false;
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
        nf.internalGraph.addOrUpdateNode(nf.originalParentTypeName, { isLeaf: true });
        if (nf.parentDefinitionDataByTypeName.has(nf.originalParentTypeName)) {
          nf.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), nf.originalParentTypeName));
          return false;
        }
        nf.lastParentNodeKind = node.kind;
        const directivesByDirectiveName = nf.extractDirectivesAndAuthorization(
          node,
          new Map<string, ConstDirectiveNode[]>(),
        );
        addEnumDefinitionDataByNode(nf.parentDefinitionDataByTypeName, node, directivesByDirectiveName);
      },
      leave() {
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    EnumTypeExtension: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        // todo can this be removed? why was it here?
        // nf.internalGraph.addNode(nf.originalParentTypeName);
        nf.lastParentNodeKind = node.kind;
        nf.isCurrentParentExtension = true;
        const extension = nf.parentExtensionDataByTypeName.get(nf.originalParentTypeName);
        if (extension) {
          if (extension.kind !== Kind.ENUM_TYPE_EXTENSION) {
            nf.errors.push(incompatibleExtensionKindsError(node, extension.kind));
            return false;
          }
          nf.extractDirectivesAndAuthorization(node, extension.directivesByDirectiveName);
          return;
        }
        const directivesByDirectiveName = nf.extractDirectivesAndAuthorization(
          node,
          new Map<string, ConstDirectiveNode[]>(),
        );
        addEnumExtensionDataByNode(nf.parentExtensionDataByTypeName, node, directivesByDirectiveName);
      },
      leave() {
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
        nf.isCurrentParentExtension = false;
      },
    },
    EnumValueDefinition: {
      enter(node) {
        nf.childName = node.name.value;
        nf.lastChildNodeKind = node.kind;
        const parentData = nf.isCurrentParentExtension
          ? getOrThrowError(nf.parentExtensionDataByTypeName, nf.originalParentTypeName, EXTENSIONS)
          : getOrThrowError(nf.parentDefinitionDataByTypeName, nf.originalParentTypeName, PARENT_DEFINITION_DATA);
        if (parentData.kind !== Kind.ENUM_TYPE_DEFINITION && parentData.kind !== Kind.ENUM_TYPE_EXTENSION) {
          nf.errors.push(
            unexpectedParentKindForChildError(
              nf.originalParentTypeName,
              'enum or enum extension',
              kindToTypeString(parentData.kind),
              nf.childName,
              kindToTypeString(node.kind),
            ),
          );
          return false;
        }
        if (parentData.enumValueDataByValueName.has(nf.childName)) {
          const error = nf.isCurrentParentExtension
            ? duplicateValueExtensionError('enum', nf.originalParentTypeName, nf.childName)
            : duplicateEnumValueDefinitionError(nf.childName, nf.originalParentTypeName);
          nf.errors.push(error);
          return;
        }
        addEnumValueDataByNode(
          parentData.enumValueDataByValueName,
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          nf.originalParentTypeName,
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
          nf.extractEventDirectivesToConfiguration(node);
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
        const parentData = nf.isCurrentParentExtension
          ? getOrThrowError(nf.parentExtensionDataByTypeName, nf.originalParentTypeName, EXTENSIONS)
          : getOrThrowError(nf.parentDefinitionDataByTypeName, nf.originalParentTypeName, PARENT_DEFINITION_DATA);
        if (
          parentData.kind !== Kind.OBJECT_TYPE_DEFINITION &&
          parentData.kind !== Kind.OBJECT_TYPE_EXTENSION &&
          parentData.kind !== Kind.INTERFACE_TYPE_DEFINITION &&
          parentData.kind !== Kind.INTERFACE_TYPE_EXTENSION
        ) {
          nf.errors.push(
            unexpectedParentKindForChildError(
              nf.originalParentTypeName,
              'object, object extension, interface, or interface extension',
              kindToTypeString(parentData.kind),
              nf.childName,
              kindToTypeString(node.kind),
            ),
          );
          return false;
        }
        if (parentData.fieldDataByFieldName.has(nf.childName)) {
          nf.errors.push(duplicateFieldDefinitionError(nf.childName, nf.originalParentTypeName));
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
        const entityData = nf.entityDataByTypeName.get(nf.originalParentTypeName);
        if (entityData) {
          entityData.fieldNames.add(nf.childName);
          // Only entities will have an existing FieldSet
          const existingFieldSet = nf.fieldSetDataByTypeName.get(nf.originalParentTypeName);
          if (existingFieldSet) {
            // @requires should only be defined on a field whose parent is an entity
            // If there is existingFieldSet, it's an entity
            extractFieldSetValue(
              nf.childName,
              existingFieldSet.requires,
              fieldData.directivesByDirectiveName.get(REQUIRES),
            );
            // @provides only makes sense on entities, but the field can be encountered before the type definition
            // When the FieldSet is evaluated, it will be checked whether the field is an entity.
            extractFieldSetValue(
              nf.childName,
              existingFieldSet.provides,
              fieldData.directivesByDirectiveName.get(PROVIDES),
            );
            return;
          }
        }
        const providesDirectives = fieldData.directivesByDirectiveName.get(PROVIDES);
        // Check whether the directive exists to avoid creating unnecessary fieldSet configurations
        if (!providesDirectives) {
          return;
        }
        const fieldSetContainer = getValueOrDefault(
          nf.fieldSetDataByTypeName,
          nf.originalParentTypeName,
          newFieldSetData,
        );
        // @provides only makes sense on entities, but the field can be encountered before the type definition
        // When the FieldSet is evaluated, it will be checked whether the field is an entity.
        extractFieldSetValue(nf.childName, fieldSetContainer.provides, providesDirectives);
      },
      leave() {
        nf.childName = '';
        nf.lastChildNodeKind = Kind.NULL;
      },
    },
    InputObjectTypeDefinition: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        if (nf.parentDefinitionDataByTypeName.has(nf.originalParentTypeName)) {
          nf.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), nf.originalParentTypeName));
          return false;
        }
        nf.lastParentNodeKind = node.kind;
        addInputObjectDefinitionDataByNode(
          nf.parentDefinitionDataByTypeName,
          node,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          nf.subgraphName,
          nf.errors,
        );
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
        nf.isCurrentParentExtension = true;
        const extension = nf.parentExtensionDataByTypeName.get(nf.originalParentTypeName);
        if (extension) {
          if (extension.kind !== Kind.INPUT_OBJECT_TYPE_EXTENSION) {
            nf.errors.push(incompatibleExtensionKindsError(node, extension.kind));
            return false;
          }
          extractDirectives(
            node,
            extension.directivesByDirectiveName,
            nf.errors,
            nf.directiveDefinitionByDirectiveName,
            nf.handledRepeatedDirectivesByHostPath,
            nf.originalParentTypeName,
          );
          return;
        }
        addInputObjectExtensionDataByNode(
          nf.parentExtensionDataByTypeName,
          node,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          nf.errors,
        );
      },
      leave() {
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
        nf.isCurrentParentExtension = false;
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
        const parentData = nf.isCurrentParentExtension
          ? getOrThrowError(nf.parentExtensionDataByTypeName, nf.originalParentTypeName, EXTENSIONS)
          : getOrThrowError(nf.parentDefinitionDataByTypeName, nf.originalParentTypeName, PARENT_DEFINITION_DATA);
        if (
          parentData.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION &&
          parentData.kind !== Kind.INPUT_OBJECT_TYPE_EXTENSION
        ) {
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
          nf.errors.push(duplicateValueExtensionError('input', nf.originalParentTypeName, name));
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
        const typeName = node.name.value;
        nf.originalParentTypeName = typeName;
        nf.lastParentNodeKind = node.kind;
        if (isNodeExtension(node)) {
          return nf.handleExtensionWithFields(node);
        }
        if (nf.parentDefinitionDataByTypeName.has(typeName)) {
          nf.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), typeName));
          return false;
        }
        const entityInterfaceData = nf.entityInterfaceDataByTypeName.get(typeName);
        addInterfaceDefinitionDataByNode(
          nf.parentDefinitionDataByTypeName,
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          !!entityInterfaceData,
          nf.subgraphName,
        );
        if (!entityInterfaceData) {
          return;
        }
        for (const fieldNode of node.fields || []) {
          entityInterfaceData.interfaceFieldNames.add(fieldNode.name.value);
        }
      },
      leave() {
        // @extends treats the node as an extension, so fetch the correct data
        const parentData = nf.isCurrentParentExtension
          ? getOrThrowError(nf.parentExtensionDataByTypeName, nf.originalParentTypeName, PARENT_EXTENSION_DATA_MAP)
          : getOrThrowError(nf.parentDefinitionDataByTypeName, nf.originalParentTypeName, PARENT_DEFINITION_DATA_MAP);
        removeInheritableDirectivesFromParentWithFieldsData(parentData);
        nf.isCurrentParentExtension = false;
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    InterfaceTypeExtension: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        nf.lastParentNodeKind = node.kind;
        return nf.handleExtensionWithFields(node);
      },
      leave() {
        removeInheritableDirectivesFromParentWithFieldsData(
          getOrThrowError(nf.parentExtensionDataByTypeName, nf.originalParentTypeName, PARENT_EXTENSION_DATA_MAP),
        );
        nf.isCurrentParentExtension = false;
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    ObjectTypeDefinition: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        if (nf.originalParentTypeName === SERVICE_OBJECT) {
          return false;
        }
        isParentRootType = isTypeNameRootType(nf.originalParentTypeName, nf.operationTypeNodeByTypeName);
        nf.renamedParentTypeName = getRenamedRootTypeName(nf.originalParentTypeName, nf.operationTypeNodeByTypeName);
        nf.originalTypeNameByRenamedTypeName.set(nf.renamedParentTypeName, nf.originalParentTypeName);
        currentParentNode = isParentRootType
          ? nf.internalGraph.getRootNode(nf.renamedParentTypeName as RootTypeName)
          : nf.internalGraph.addOrUpdateNode(nf.renamedParentTypeName);
        nf.lastParentNodeKind = node.kind;
        nf.addConcreteTypesForImplementedInterfaces(node);
        nf.handleInterfaceObject(node);
        // handling for @extends directive
        if (isNodeExtension(node)) {
          return nf.handleExtensionWithFields(node, isParentRootType);
        }
        if (nf.parentDefinitionDataByTypeName.has(nf.originalParentTypeName)) {
          nf.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), nf.originalParentTypeName));
          return false;
        }
        addObjectDefinitionDataByNode(
          nf.parentDefinitionDataByTypeName,
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          isObjectLikeNodeEntity(node),
          isParentRootType,
          nf.subgraphName || N_A,
          nf.renamedParentTypeName,
        );
      },
      leave() {
        // @extends treats the node as an extension, so fetch the correct data
        const parentData = nf.isCurrentParentExtension
          ? getOrThrowError(nf.parentExtensionDataByTypeName, nf.originalParentTypeName, PARENT_EXTENSION_DATA_MAP)
          : getOrThrowError(nf.parentDefinitionDataByTypeName, nf.originalParentTypeName, PARENT_DEFINITION_DATA_MAP);
        removeInheritableDirectivesFromParentWithFieldsData(parentData);
        currentParentNode = undefined;
        isParentRootType = false;
        nf.isCurrentParentExtension = false;
        nf.originalParentTypeName = '';
        nf.renamedParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    ObjectTypeExtension: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        if (nf.originalParentTypeName === SERVICE_OBJECT) {
          return false;
        }
        isParentRootType = isTypeNameRootType(nf.originalParentTypeName, nf.operationTypeNodeByTypeName);
        nf.renamedParentTypeName = getRenamedRootTypeName(nf.originalParentTypeName, nf.operationTypeNodeByTypeName);
        nf.originalTypeNameByRenamedTypeName.set(nf.renamedParentTypeName, nf.originalParentTypeName);
        currentParentNode = isParentRootType
          ? nf.internalGraph.getRootNode(nf.renamedParentTypeName as RootTypeName)
          : nf.internalGraph.addOrUpdateNode(nf.renamedParentTypeName);
        nf.lastParentNodeKind = node.kind;
        nf.addConcreteTypesForImplementedInterfaces(node);
        return nf.handleExtensionWithFields(node, isParentRootType);
      },
      leave() {
        removeInheritableDirectivesFromParentWithFieldsData(
          getOrThrowError(nf.parentExtensionDataByTypeName, nf.originalParentTypeName, PARENT_EXTENSION_DATA_MAP),
        );
        currentParentNode = undefined;
        isParentRootType = false;
        nf.isCurrentParentExtension = false;
        nf.originalParentTypeName = '';
        nf.renamedParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    ScalarTypeDefinition: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        if (nf.originalParentTypeName === ANY_SCALAR) {
          return false;
        }
        if (nf.parentDefinitionDataByTypeName.has(nf.originalParentTypeName)) {
          nf.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), nf.originalParentTypeName));
          return false;
        }
        nf.internalGraph.addOrUpdateNode(nf.originalParentTypeName, { isLeaf: true });
        nf.lastParentNodeKind = node.kind;
        const directivesByDirectiveName = nf.extractDirectivesAndAuthorization(
          node,
          new Map<string, ConstDirectiveNode[]>(),
        );
        addScalarDefinitionDataByNode(nf.parentDefinitionDataByTypeName, node, directivesByDirectiveName);
      },
      leave() {
        nf.originalParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    ScalarTypeExtension: {
      enter(node) {
        nf.originalParentTypeName = node.name.value;
        if (nf.originalParentTypeName === ANY_SCALAR) {
          return false;
        }
        nf.lastParentNodeKind = node.kind;
        // todo
        // nf.internalGraph.addOrUpdateNode(nf.originalParentTypeName, { isLeaf: true });
        const extension = nf.parentExtensionDataByTypeName.get(nf.originalParentTypeName);
        if (extension) {
          if (extension.kind !== Kind.SCALAR_TYPE_EXTENSION) {
            nf.errors.push(incompatibleExtensionKindsError(node, extension.kind));
            return false;
          }
          nf.extractDirectivesAndAuthorization(node, extension.directivesByDirectiveName);
          return false;
        }
        const directivesByDirectiveName = nf.extractDirectivesAndAuthorization(
          node,
          new Map<string, ConstDirectiveNode[]>(),
        );
        addScalarExtensionDataByNode(nf.parentExtensionDataByTypeName, node, directivesByDirectiveName);
        return false;
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
        const parentData =
          nf.parentDefinitionDataByTypeName.get(node.name.value) ||
          nf.parentExtensionDataByTypeName.get(node.name.value);
        if (!parentData) {
          return false;
        }
        nf.originalParentTypeName = parentData.name;
        nf.renamedParentTypeName = (parentData as ObjectData).renamedTypeName;
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
        const parentData =
          nf.parentDefinitionDataByTypeName.get(node.name.value) ||
          nf.parentExtensionDataByTypeName.get(node.name.value);
        if (!parentData) {
          return false;
        }
        nf.originalParentTypeName = parentData.name;
        nf.renamedParentTypeName = (parentData as ObjectData).renamedTypeName;
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
