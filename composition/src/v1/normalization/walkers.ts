import { ConstDirectiveNode, DocumentNode, Kind, visit } from 'graphql';
import {
  duplicateEnumValueDefinitionError,
  duplicateFieldDefinitionError,
  duplicateInputFieldDefinitionError,
  duplicateOperationTypeDefinitionError,
  invalidOperationTypeDefinitionError,
  unexpectedParentKindForChildError,
} from '../../errors/errors';
import { NormalizationFactory } from './normalization-factory';
import {
  BASE_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME,
  BASE_SCALARS,
  CONFIGURE_CHILD_DESCRIPTIONS_DEFINITION,
  CONFIGURE_DESCRIPTION_DEFINITION,
  SUBSCRIPTION_FILTER_DEFINITION,
  V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME,
} from '../utils/constants';
import {
  mergeAuthorizationDataByAND,
  newAuthorizationData,
  newFieldAuthorizationData,
  setAndGetValue,
  upsertEntityData,
} from '../utils/utils';
import { formatDescription, isNodeInterfaceObject, isObjectLikeNodeEntity } from '../../ast/utils';
import { extractFieldSetValue, newFieldSetData } from './utils';
import { EVENT_DIRECTIVE_NAMES } from '../utils/string-constants';
import {
  getRenamedRootTypeName,
  isParentDataInterfaceType,
  isTypeNameRootType,
  newPersistedDirectivesData,
} from '../../schema-building/utils';
import {
  AuthorizationData,
  ConfigureDescriptionData,
  InputValueData,
  ObjectDefinitionData,
} from '../../schema-building/types';
import { getMutableEnumValueNode, getTypeNodeNamedTypeName } from '../../schema-building/ast';
import { GraphNode, RootNode } from '../../resolvability-graph/graph-nodes';
import { requiresDefinedOnNonEntityFieldWarning } from '../warnings/warnings';
import {
  ANY_SCALAR,
  CONFIGURE_CHILD_DESCRIPTIONS,
  CONFIGURE_DESCRIPTION,
  ENTITIES_FIELD,
  ENTITY_UNION,
  EXTERNAL,
  PARENT_DEFINITION_DATA,
  PROVIDES,
  REQUIRES,
  SERVICE_FIELD,
  SERVICE_OBJECT,
  SUBSCRIPTION_FILTER,
} from '../../utils/string-constants';
import { RootTypeName } from '../../utils/types';
import { getOrThrowError, getValueOrDefault, kindToTypeString } from '../../utils/utils';
import { KeyFieldSetData } from './types';

/* Walker to collect schema definition, directive definitions, and entities.
 * Directives are not validated upon immediate extract because all types must be recorded first.
 * * */
export function upsertDirectiveSchemaAndEntityDefinitions(nf: NormalizationFactory, document: DocumentNode) {
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
        switch (name) {
          case SUBSCRIPTION_FILTER: {
            nf.directiveDefinitionByDirectiveName.set(SUBSCRIPTION_FILTER, SUBSCRIPTION_FILTER_DEFINITION);
            break;
          }
          case CONFIGURE_DESCRIPTION: {
            nf.directiveDefinitionByDirectiveName.set(CONFIGURE_DESCRIPTION, CONFIGURE_DESCRIPTION_DEFINITION);
            break;
          }
          case CONFIGURE_CHILD_DESCRIPTIONS: {
            nf.directiveDefinitionByDirectiveName.set(
              CONFIGURE_CHILD_DESCRIPTIONS,
              CONFIGURE_CHILD_DESCRIPTIONS_DEFINITION,
            );
            break;
          }
        }
        nf.referencedDirectiveNames.add(name);
      },
    },
    DirectiveDefinition: {
      enter(node) {
        if (nf.addDirectiveDefinitionDataByNode(node)) {
          nf.customDirectiveDefinitions.set(node.name.value, node);
        }
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
        const keyFieldSetDataByFieldSet = getValueOrDefault(
          nf.keyFieldSetDatasByTypeName,
          typeName,
          () => new Map<string, KeyFieldSetData>(),
        );
        nf.extractKeyFieldSets(node, keyFieldSetDataByFieldSet);
        upsertEntityData({
          entityDataByTypeName: nf.entityDataByTypeName,
          keyFieldSetDataByFieldSet,
          subgraphName: nf.subgraphName,
          typeName,
        });
        getValueOrDefault(nf.entityInterfaceDataByTypeName, typeName, () => ({
          concreteTypeNames: new Set<string>(),
          fieldDatas: [],
          interfaceFieldNames: new Set<string>(),
          interfaceObjectFieldNames: new Set<string>(),
          isInterfaceObject: false,
          resolvable: false,
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
        const keyFieldSetDataByFieldSet = getValueOrDefault(
          nf.keyFieldSetDatasByTypeName,
          typeName,
          () => new Map<string, KeyFieldSetData>(),
        );
        nf.extractKeyFieldSets(node, keyFieldSetDataByFieldSet);
        upsertEntityData({
          entityDataByTypeName: nf.entityDataByTypeName,
          keyFieldSetDataByFieldSet,
          subgraphName: nf.subgraphName,
          typeName,
        });
        getValueOrDefault(nf.entityInterfaceDataByTypeName, typeName, () => ({
          concreteTypeNames: new Set<string>(),
          fieldDatas: [],
          interfaceFieldNames: new Set<string>(),
          interfaceObjectFieldNames: new Set<string>(),
          isInterfaceObject: false,
          resolvable: false,
          typeName,
        }));
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
            concreteTypeNames: new Set<string>(),
            fieldDatas: [],
            interfaceObjectFieldNames: new Set<string>(),
            interfaceFieldNames: new Set<string>(),
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
        nf.extractKeyFieldSets(node, keyFieldSetDataByFieldSet);
        upsertEntityData({
          entityDataByTypeName: nf.entityDataByTypeName,
          keyFieldSetDataByFieldSet,
          subgraphName: nf.subgraphName,
          typeName,
        });
      },
    },
    ObjectTypeExtension: {
      enter(node) {
        if (!isObjectLikeNodeEntity(node)) {
          return;
        }
        const typeName = node.name.value;
        const keyFieldSetDataByFieldSet = getValueOrDefault(
          nf.keyFieldSetDatasByTypeName,
          typeName,
          () => new Map<string, KeyFieldSetData>(),
        );
        nf.extractKeyFieldSets(node, keyFieldSetDataByFieldSet);
        upsertEntityData({
          entityDataByTypeName: nf.entityDataByTypeName,
          keyFieldSetDataByFieldSet,
          subgraphName: nf.subgraphName,
          typeName,
        });
      },
    },
    OperationTypeDefinition: {
      enter(node) {
        const operationType = node.operation;
        const definitionNode = nf.schemaData.operationTypes.get(operationType);
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
        nf.schemaData.operationTypes.set(operationType, node);
        return false;
      },
    },
    SchemaDefinition: {
      enter(node) {
        nf.schemaData.description = node.description;
        nf.extractDirectives(node, nf.schemaData.directivesByDirectiveName);
      },
    },
    SchemaExtension: {
      enter(node) {
        nf.extractDirectives(node, nf.schemaData.directivesByDirectiveName);
      },
    },
  });
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
        // TODO remove necessity for childName eventually
        const name = node.name.value;
        nf.childName = name;
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
              'Enum or Enum extension',
              kindToTypeString(parentData.kind),
              name,
              kindToTypeString(node.kind),
            ),
          );
          return;
        }
        if (parentData.enumValueDataByValueName.has(name)) {
          nf.errors.push(duplicateEnumValueDefinitionError(nf.originalParentTypeName, name));
          return;
        }
        parentData.enumValueDataByValueName.set(name, {
          appearances: 1,
          configureDescriptionDataBySubgraphName: new Map<string, ConfigureDescriptionData>(),
          directivesByDirectiveName: nf.extractDirectives(node, new Map<string, ConstDirectiveNode[]>()),
          kind: Kind.ENUM_VALUE_DEFINITION,
          name,
          node: getMutableEnumValueNode(node),
          parentTypeName: nf.originalParentTypeName,
          persistedDirectivesData: newPersistedDirectivesData(),
          subgraphNames: new Set([nf.subgraphName]),
          description: formatDescription(node.description),
        });
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
        const argumentDataByArgumentName = nf.extractArguments(new Map<string, InputValueData>(), node);
        const directivesByDirectiveName = nf.extractDirectives(node, new Map<string, ConstDirectiveNode[]>());
        // Add parent-level shareable and external to the field extraction and repeatable validation
        if (!isParentDataInterfaceType(parentData)) {
          nf.addInheritedDirectivesToFieldData(directivesByDirectiveName);
          if (directivesByDirectiveName.has(EXTERNAL)) {
            nf.unvalidatedExternalFieldCoords.add(`${nf.originalParentTypeName}.${node.name.value}`);
          }
        }
        const fieldData = nf.addFieldDataByNode(
          parentData.fieldDataByFieldName,
          node,
          argumentDataByArgumentName,
          directivesByDirectiveName,
        );
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
              name,
              kindToTypeString(node.kind),
            ),
          );
          return false;
        }
        if (parentData.inputValueDataByValueName.has(name)) {
          nf.errors.push(duplicateInputFieldDefinitionError(nf.originalParentTypeName, name));
          return;
        }
        nf.addInputValueDataByNode(parentData.inputValueDataByValueName, node, valuePath);
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
        currentParentNode = undefined;
        isParentRootType = false;
        nf.originalParentTypeName = '';
        nf.renamedParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
        nf.isParentObjectExternal = false;
        nf.isParentObjectShareable = false;
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
        currentParentNode = undefined;
        isParentRootType = false;
        nf.originalParentTypeName = '';
        nf.renamedParentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
        nf.isParentObjectExternal = false;
        nf.isParentObjectShareable = false;
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
