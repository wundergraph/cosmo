import { ConstDirectiveNode, DocumentNode, Kind, visit } from 'graphql';
import { getNamedTypeForChild } from '../schema-building/type-merging';
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
  unexpectedKindFatalError,
} from '../errors/errors';
import { NormalizationFactory } from './normalization-factory';
import {
  BASE_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME,
  BASE_SCALARS,
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
  upsertEntityContainerProperties,
} from '../utils/utils';
import {
  addConcreteTypesForImplementedInterfaces,
  addConcreteTypesForUnion,
  isNodeExtension,
  isObjectLikeNodeEntity,
} from '../ast/utils';
import { extractFieldSetValue, newFieldSetContainer } from './utils';
import {
  ANY_SCALAR,
  ENTITIES_FIELD,
  ENTITY_UNION,
  EXTENSIONS,
  N_A,
  PARENT_DEFINITION_DATA_MAP,
  PARENT_EXTENSION_DATA_MAP,
  PARENTS,
  PROVIDES,
  REQUIRES,
  SCHEMA,
  SERVICE_FIELD,
  SERVICE_OBJECT,
} from '../utils/string-constants';
import {
  addInheritedDirectivesToFieldData,
  extractArguments,
  extractDirectives,
  extractUniqueUnionMembers,
  isTypeNameRootType,
  removeInheritableDirectivesFromParentWithFieldsData,
  upsertEnumDefinitionDataByNode,
  upsertEnumExtensionDataByNode,
  upsertEnumValueDataByNode,
  upsertFieldDataByNode,
  upsertInputObjectDefinitionDataByNode,
  upsertInputObjectExtensionDataByNode,
  upsertInputValueDataByNode,
  upsertInterfaceDefinitionDataByNode,
  upsertObjectDefinitionDataByNode,
  upsertScalarDefinitionDataByNode,
  upsertScalarExtensionDataByNode,
  upsertUnionDefinitionDataByNode,
  upsertUnionExtensionDataByNode,
} from '../schema-building/utils';
import { ArgumentData } from '../schema-building/type-definition-data';

// Walker to collect schema definition and directive definitions
export function upsertDirectiveAndSchemaDefinitions(nf: NormalizationFactory, document: DocumentNode) {
  const definedDirectives = new Set<string>();
  visit(document, {
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
        nf.directiveDefinitionByDirectiveName.set(name, node);
        nf.customDirectiveDefinitions.set(name, node);
        return false;
      },
    },
    OperationTypeDefinition: {
      enter(node) {
        const operationType = node.operation;
        const operationPath = `${nf.parentTypeName}.${operationType}`;
        const definitionNode = nf.schemaDefinition.operationTypes.get(operationType);
        const newTypeName = getNamedTypeForChild(operationPath, node.type);
        if (definitionNode) {
          duplicateOperationTypeDefinitionError(
            operationType,
            newTypeName,
            getNamedTypeForChild(operationPath, definitionNode.type),
          );
          return false;
        }
        const existingOperationType = nf.operationTypeNames.get(newTypeName);
        if (existingOperationType) {
          nf.errors.push(invalidOperationTypeDefinitionError(existingOperationType, newTypeName, operationType));
          return false;
        }
        nf.operationTypeNames.set(newTypeName, operationType);
        nf.schemaDefinition.operationTypes.set(operationType, node);
        return false;
      },
    },
    SchemaDefinition: {
      enter(node) {
        extractDirectives(
          node,
          nf.schemaDefinition.directivesByDirectiveName,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          SCHEMA,
        );
        nf.schemaDefinition.description = node.description;
      },
    },
    SchemaExtension: {
      enter(node) {
        extractDirectives(
          node,
          nf.schemaDefinition.directivesByDirectiveName,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          SCHEMA,
        );
      },
    },
  });
}

export function upsertParentsAndChildren(nf: NormalizationFactory, document: DocumentNode) {
  let isParentRootType = false;
  visit(document, {
    Directive: {
      enter(node) {
        const name = node.name.value;
        if (V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME.has(name)) {
          nf.isSubgraphVersionTwo = true;
          return false;
        }
        if (BASE_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME.has(name)) {
          return false;
        }
        nf.referencedDirectiveNames.add(name);
      },
    },
    EnumTypeDefinition: {
      enter(node) {
        nf.parentTypeName = node.name.value;
        if (nf.parentDefinitionDataByTypeName.has(nf.parentTypeName)) {
          nf.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), nf.parentTypeName));
          return false;
        }
        nf.lastParentNodeKind = node.kind;
        const directivesByDirectiveName = nf.extractDirectivesAndAuthorization(
          node,
          new Map<string, ConstDirectiveNode[]>(),
        );
        upsertEnumDefinitionDataByNode(nf.parentDefinitionDataByTypeName, node, directivesByDirectiveName);
      },
      leave() {
        nf.parentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    EnumTypeExtension: {
      enter(node) {
        nf.parentTypeName = node.name.value;
        nf.lastParentNodeKind = node.kind;
        nf.isCurrentParentExtension = true;
        const extension = nf.parentExtensionDataByTypeName.get(nf.parentTypeName);
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
        upsertEnumExtensionDataByNode(nf.parentExtensionDataByTypeName, node, directivesByDirectiveName);
      },
      leave() {
        nf.parentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
        nf.isCurrentParentExtension = false;
      },
    },
    EnumValueDefinition: {
      enter(node) {
        nf.childName = node.name.value;
        nf.lastChildNodeKind = node.kind;
        const parent = nf.isCurrentParentExtension
          ? getOrThrowError(nf.parentExtensionDataByTypeName, nf.parentTypeName, EXTENSIONS)
          : getOrThrowError(nf.parentDefinitionDataByTypeName, nf.parentTypeName, PARENTS);
        if (parent.kind !== Kind.ENUM_TYPE_DEFINITION && parent.kind !== Kind.ENUM_TYPE_EXTENSION) {
          throw unexpectedKindFatalError(nf.childName);
        }
        if (parent.enumValueDataByValueName.has(nf.childName)) {
          const error = nf.isCurrentParentExtension
            ? duplicateValueExtensionError('enum', nf.parentTypeName, nf.childName)
            : duplicateEnumValueDefinitionError(nf.childName, nf.parentTypeName);
          nf.errors.push(error);
          return;
        }
        upsertEnumValueDataByNode(
          parent.enumValueDataByValueName,
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          nf.parentTypeName,
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
          nf.extractEventDirectivesToConfiguration(node);
          if (nf.childName === SERVICE_FIELD || nf.childName === ENTITIES_FIELD) {
            return false;
          }
        }
        nf.lastChildNodeKind = node.kind;
        const fieldPath = `${nf.parentTypeName}.${nf.childName}`;
        nf.lastChildNodeKind = node.kind;
        const fieldNamedTypeName = getNamedTypeForChild(fieldPath, node.type);
        if (!BASE_SCALARS.has(fieldNamedTypeName)) {
          nf.referencedTypeNames.add(fieldNamedTypeName);
        }
        const parentData = nf.isCurrentParentExtension
          ? getOrThrowError(nf.parentExtensionDataByTypeName, nf.parentTypeName, EXTENSIONS)
          : getOrThrowError(nf.parentDefinitionDataByTypeName, nf.parentTypeName, PARENTS);
        if (
          parentData.kind !== Kind.OBJECT_TYPE_DEFINITION &&
          parentData.kind !== Kind.OBJECT_TYPE_EXTENSION &&
          parentData.kind !== Kind.INTERFACE_TYPE_DEFINITION &&
          parentData.kind !== Kind.INTERFACE_TYPE_EXTENSION
        ) {
          throw unexpectedKindFatalError(nf.parentTypeName);
        }
        if (parentData.fieldDataByFieldName.has(nf.childName)) {
          nf.errors.push(duplicateFieldDefinitionError(nf.childName, nf.parentTypeName));
          return;
        }
        const argumentDataByArgumentName = extractArguments(
          new Map<string, ArgumentData>(),
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          nf.parentsWithChildArguments,
          nf.parentTypeName,
          nf.subgraphName || N_A,
        );
        const directivesByDirectiveName = nf.extractDirectivesAndAuthorization(
          node,
          addInheritedDirectivesToFieldData(
            parentData.directivesByDirectiveName,
            new Map<string, ConstDirectiveNode[]>(),
          ),
        );
        const fieldData = upsertFieldDataByNode(
          parentData.fieldDataByFieldName,
          node,
          nf.errors,
          argumentDataByArgumentName,
          directivesByDirectiveName,
          nf.parentTypeName,
          nf.subgraphName || N_A,
          nf.isSubgraphVersionTwo,
        );
        const entityContainer = nf.entityContainerByTypeName.get(nf.parentTypeName);
        if (entityContainer) {
          entityContainer.fieldNames.add(nf.childName);
          // Only entities will have an existing FieldSet
          const existingFieldSet = nf.fieldSetContainerByTypeName.get(nf.parentTypeName);
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
          nf.fieldSetContainerByTypeName,
          nf.parentTypeName,
          newFieldSetContainer,
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
        nf.parentTypeName = node.name.value;
        if (nf.parentDefinitionDataByTypeName.has(nf.parentTypeName)) {
          nf.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), nf.parentTypeName));
          return false;
        }
        nf.lastParentNodeKind = node.kind;
        upsertInputObjectDefinitionDataByNode(
          nf.parentDefinitionDataByTypeName,
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
        );
      },
      leave() {
        nf.lastParentNodeKind = Kind.NULL;
        nf.parentTypeName = '';
      },
    },
    InputObjectTypeExtension: {
      enter(node) {
        nf.parentTypeName = node.name.value;
        nf.lastParentNodeKind = node.kind;
        nf.isCurrentParentExtension = true;
        const extension = nf.parentExtensionDataByTypeName.get(nf.parentTypeName);
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
            nf.parentTypeName,
          );
          return;
        }
        upsertInputObjectExtensionDataByNode(
          nf.parentExtensionDataByTypeName,
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
        );
      },
      leave() {
        nf.parentTypeName = '';
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
        const valueRootTypeName = getNamedTypeForChild(`${nf.parentTypeName}.${name}`, node.type);
        if (!BASE_SCALARS.has(valueRootTypeName)) {
          nf.referencedTypeNames.add(valueRootTypeName);
        }
        const parent = nf.isCurrentParentExtension
          ? getOrThrowError(nf.parentExtensionDataByTypeName, nf.parentTypeName, EXTENSIONS)
          : getOrThrowError(nf.parentDefinitionDataByTypeName, nf.parentTypeName, PARENTS);
        if (parent.kind !== Kind.INPUT_OBJECT_TYPE_DEFINITION && parent.kind !== Kind.INPUT_OBJECT_TYPE_EXTENSION) {
          throw unexpectedKindFatalError(nf.parentTypeName);
        }
        if (parent.inputValueDataByValueName.has(name)) {
          nf.errors.push(duplicateValueExtensionError('input', nf.parentTypeName, name));
          return;
        }
        upsertInputValueDataByNode(
          parent.inputValueDataByValueName,
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          nf.parentTypeName,
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
        nf.parentTypeName = typeName;
        nf.lastParentNodeKind = node.kind;
        if (isNodeExtension(node)) {
          return nf.handleExtensionWithFields(node);
        }
        if (nf.parentDefinitionDataByTypeName.has(typeName)) {
          nf.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), typeName));
          return false;
        }
        const isEntity = isObjectLikeNodeEntity(node);
        upsertInterfaceDefinitionDataByNode(
          nf.parentDefinitionDataByTypeName,
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          isEntity,
          nf.subgraphName || N_A,
        );
        if (!isEntity) {
          return;
        }
        nf.entityInterfaces.set(typeName, {
          concreteTypeNames: new Set<string>(),
          interfaceFieldNames: new Set<string>(node.fields?.map((field) => field.name.value)),
          interfaceObjectFieldNames: new Set<string>(),
          isInterfaceObject: false,
          typeName: typeName,
        });
        upsertEntityContainerProperties(nf.entityContainerByTypeName, {
          typeName: nf.parentTypeName,
          ...(nf.subgraphName ? { subgraphNames: [nf.subgraphName] } : {}),
        });
        const fieldSetContainer = getValueOrDefault(nf.fieldSetContainerByTypeName, typeName, newFieldSetContainer);
        nf.extractKeyFieldSets(node, fieldSetContainer);
      },
      leave() {
        // @extends treats the node as an extension, so fetch the correct data
        const parentData = nf.isCurrentParentExtension
          ? getOrThrowError(nf.parentExtensionDataByTypeName, nf.parentTypeName, PARENT_EXTENSION_DATA_MAP)
          : getOrThrowError(nf.parentDefinitionDataByTypeName, nf.parentTypeName, PARENT_DEFINITION_DATA_MAP);
        removeInheritableDirectivesFromParentWithFieldsData(parentData);
        nf.isCurrentParentExtension = false;
        nf.parentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    InterfaceTypeExtension: {
      enter(node) {
        nf.parentTypeName = node.name.value;
        nf.lastParentNodeKind = node.kind;
        return nf.handleExtensionWithFields(node);
      },
      leave() {
        removeInheritableDirectivesFromParentWithFieldsData(
          getOrThrowError(nf.parentExtensionDataByTypeName, nf.parentTypeName, PARENT_EXTENSION_DATA_MAP),
        );
        nf.isCurrentParentExtension = false;
        nf.parentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    ObjectTypeDefinition: {
      enter(node) {
        const typeName = node.name.value;
        if (typeName === SERVICE_OBJECT) {
          return false;
        }
        isParentRootType = isTypeNameRootType(typeName, nf.operationTypeNames);
        nf.parentTypeName = typeName;
        nf.lastParentNodeKind = node.kind;
        addConcreteTypesForImplementedInterfaces(node, nf.abstractToConcreteTypeNames);
        nf.handleInterfaceObject(node);
        // handling for @extends directive
        if (isNodeExtension(node)) {
          return nf.handleExtensionWithFields(node);
        }
        if (nf.parentDefinitionDataByTypeName.has(typeName)) {
          nf.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), typeName));
          return false;
        }
        const isEntity = isObjectLikeNodeEntity(node);
        upsertObjectDefinitionDataByNode(
          nf.parentDefinitionDataByTypeName,
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          isEntity,
          isParentRootType,
          nf.subgraphName || 'N/A',
        );
        if (!isEntity) {
          return;
        }
        const fieldSetContainer = getValueOrDefault(nf.fieldSetContainerByTypeName, typeName, newFieldSetContainer);
        nf.extractKeyFieldSets(node, fieldSetContainer);
        upsertEntityContainerProperties(nf.entityContainerByTypeName, {
          typeName: nf.parentTypeName,
          keyFieldSets: fieldSetContainer.keys,
          ...(nf.subgraphName ? { subgraphNames: [nf.subgraphName] } : {}),
        });
      },
      leave() {
        // @extends treats the node as an extension, so fetch the correct data
        const parentData = nf.isCurrentParentExtension
          ? getOrThrowError(nf.parentExtensionDataByTypeName, nf.parentTypeName, PARENT_EXTENSION_DATA_MAP)
          : getOrThrowError(nf.parentDefinitionDataByTypeName, nf.parentTypeName, PARENT_DEFINITION_DATA_MAP);
        removeInheritableDirectivesFromParentWithFieldsData(parentData);
        isParentRootType = false;
        nf.isCurrentParentExtension = false;
        nf.parentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    ObjectTypeExtension: {
      enter(node) {
        nf.parentTypeName = node.name.value;
        if (nf.parentTypeName === SERVICE_OBJECT) {
          return false;
        }
        isParentRootType = isTypeNameRootType(nf.parentTypeName, nf.operationTypeNames);
        nf.lastParentNodeKind = node.kind;
        addConcreteTypesForImplementedInterfaces(node, nf.abstractToConcreteTypeNames);
        return nf.handleExtensionWithFields(node);
      },
      leave() {
        removeInheritableDirectivesFromParentWithFieldsData(
          getOrThrowError(nf.parentExtensionDataByTypeName, nf.parentTypeName, PARENT_EXTENSION_DATA_MAP),
        );
        isParentRootType = false;
        nf.isCurrentParentExtension = false;
        nf.parentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    ScalarTypeDefinition: {
      enter(node) {
        const name = node.name.value;
        if (name === ANY_SCALAR) {
          return false;
        }
        const parent = nf.parentDefinitionDataByTypeName.get(name);
        if (parent) {
          nf.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), name));
          return false;
        }
        nf.parentTypeName = name;
        nf.lastParentNodeKind = node.kind;
        const directivesByDirectiveName = nf.extractDirectivesAndAuthorization(
          node,
          new Map<string, ConstDirectiveNode[]>(),
        );
        upsertScalarDefinitionDataByNode(nf.parentDefinitionDataByTypeName, node, directivesByDirectiveName);
      },
      leave() {
        nf.parentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    ScalarTypeExtension: {
      enter(node) {
        nf.parentTypeName = node.name.value;
        if (nf.parentTypeName === ANY_SCALAR) {
          return false;
        }
        nf.lastParentNodeKind = node.kind;
        const extension = nf.parentExtensionDataByTypeName.get(nf.parentTypeName);
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
        upsertScalarExtensionDataByNode(nf.parentExtensionDataByTypeName, node, directivesByDirectiveName);
        return false;
      },
      leave() {
        nf.parentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    UnionTypeDefinition: {
      enter(node) {
        nf.parentTypeName = node.name.value;
        if (nf.parentTypeName === ENTITY_UNION) {
          return false;
        }
        const parent = nf.parentDefinitionDataByTypeName.get(nf.parentTypeName);
        if (parent) {
          nf.errors.push(duplicateTypeDefinitionError(kindToTypeString(node.kind), nf.parentTypeName));
          return false;
        }

        nf.lastParentNodeKind = node.kind;
        upsertUnionDefinitionDataByNode(
          nf.parentDefinitionDataByTypeName,
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          nf.abstractToConcreteTypeNames,
          nf.referencedTypeNames,
        );
      },
      leave() {
        nf.parentTypeName = '';
        nf.lastParentNodeKind = Kind.NULL;
      },
    },
    UnionTypeExtension: {
      enter(node) {
        nf.parentTypeName = node.name.value;
        if (nf.parentTypeName === ENTITY_UNION) {
          return false;
        }
        const extension = nf.parentExtensionDataByTypeName.get(nf.parentTypeName);
        if (!node.types?.length) {
          nf.errors.push(noDefinedUnionMembersError(nf.parentTypeName, true));
          return false;
        }
        nf.lastParentNodeKind = node.kind;
        addConcreteTypesForUnion(node, nf.abstractToConcreteTypeNames);
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
            nf.parentTypeName,
          );
          extractUniqueUnionMembers(
            node.types,
            extension.memberByMemberTypeName,
            nf.errors,
            nf.parentTypeName,
            nf.abstractToConcreteTypeNames,
            nf.referencedTypeNames,
          );
          return false;
        }
        upsertUnionExtensionDataByNode(
          nf.parentExtensionDataByTypeName,
          node,
          nf.errors,
          nf.directiveDefinitionByDirectiveName,
          nf.handledRepeatedDirectivesByHostPath,
          nf.abstractToConcreteTypeNames,
          nf.referencedTypeNames,
        );
        return false;
      },
      leave() {
        nf.parentTypeName = '';
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
        const typeName = getNamedTypeForChild(`${nf.parentTypeName}.${nf.childName}`, node.type);
        const inheritsAuthorization = nf.leafTypeNamesWithAuthorizationDirectives.has(typeName);
        if (
          (!parentAuthorizationData || !parentAuthorizationData.hasParentLevelAuthorization) &&
          !inheritsAuthorization
        ) {
          return false;
        }
        if (!parentAuthorizationData) {
          parentAuthorizationData = setAndGetValue(
            nf.authorizationDataByParentTypeName,
            nf.parentTypeName,
            newAuthorizationData(nf.parentTypeName),
          );
        }
        const fieldAuthorizationData = getValueOrDefault(
          parentAuthorizationData.fieldAuthorizationDataByFieldName,
          nf.childName,
          () => newFieldAuthorizationData(nf.childName),
        );
        if (!mergeAuthorizationDataByAND(parentAuthorizationData, fieldAuthorizationData)) {
          nf.invalidOrScopesHostPaths.add(`${nf.parentTypeName}.${nf.childName}`);
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
          nf.invalidOrScopesHostPaths.add(`${nf.parentTypeName}.${nf.childName}`);
        }
        return false;
      },
      leave() {
        nf.childName = '';
      },
    },
    InterfaceTypeDefinition: {
      enter(node) {
        nf.parentTypeName = node.name.value;
        parentAuthorizationData = nf.getAuthorizationData(node);
        isInterfaceKind = true;
      },
      leave() {
        nf.parentTypeName = '';
        parentAuthorizationData = undefined;
        isInterfaceKind = false;
      },
    },
    InterfaceTypeExtension: {
      enter(node) {
        nf.parentTypeName = node.name.value;
        parentAuthorizationData = nf.getAuthorizationData(node);
        isInterfaceKind = true;
      },
      leave() {
        nf.parentTypeName = '';
        parentAuthorizationData = undefined;
        isInterfaceKind = false;
      },
    },
    ObjectTypeDefinition: {
      enter(node) {
        nf.parentTypeName = node.name.value;
        parentAuthorizationData = nf.getAuthorizationData(node);
      },
      leave() {
        nf.parentTypeName = '';
        parentAuthorizationData = undefined;
      },
    },
    ObjectTypeExtension: {
      enter(node) {
        nf.parentTypeName = node.name.value;
        parentAuthorizationData = nf.getAuthorizationData(node);
      },
      leave() {
        nf.parentTypeName = '';
        parentAuthorizationData = undefined;
      },
    },
  });
}
