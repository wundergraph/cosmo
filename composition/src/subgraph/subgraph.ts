import { DocumentNode, GraphQLSchema, OperationTypeNode, visit } from 'graphql';
import { FederationFactory } from '../federation/federation-factory';
import {
  addConcreteTypesForImplementedInterfaces,
  addConcreteTypesForUnion,
  isNodeExternal,
  isNodeInterfaceObject,
  isNodeShareable,
  isObjectLikeNodeEntity,
  operationTypeNodeToDefaultType,
  stringToNameNode,
} from '../ast/utils';
import { getNamedTypeForChild } from '../schema-building/type-merging';
import { EntityInterfaceSubgraphData, getOrThrowError } from '../utils/utils';
import { ENTITIES_FIELD, OPERATION_TO_DEFAULT, SERVICE_FIELD } from '../utils/string-constants';
import { ConfigurationDataByTypeName } from '../router-configuration/router-configuration';
import { ParentDefinitionData } from '../schema-building/type-definition-data';
import { ParentExtensionData } from '../schema-building/type-extension-data';

export type Subgraph = {
  definitions: DocumentNode;
  name: string;
  url: string;
};

export type InternalSubgraph = {
  configurationDataMap: ConfigurationDataByTypeName;
  definitions: DocumentNode;
  entityInterfaces: Map<string, EntityInterfaceSubgraphData>;
  isVersionTwo: boolean;
  keyFieldNamesByParentTypeName: Map<string, Set<string>>;
  name: string;
  operationTypes: Map<string, OperationTypeNode>;
  overriddenFieldNamesByParentTypeName: Map<string, Set<string>>;
  parentDataByTypeName: Map<string, ParentDefinitionData>;
  parentExtensionDataByTypeName: Map<string, ParentExtensionData>;
  schema: GraphQLSchema;
  url: string;
};

export type SubgraphConfig = {
  configurationDataMap: ConfigurationDataByTypeName;
  schema: GraphQLSchema;
};

export function recordSubgraphName(
  subgraphName: string,
  subgraphNames: Set<string>,
  nonUniqueSubgraphNames: Set<string>,
) {
  if (!subgraphNames.has(subgraphName)) {
    subgraphNames.add(subgraphName);
    return;
  }
  nonUniqueSubgraphNames.add(subgraphName);
}

// Places the object-like nodes into the multigraph including the concrete types for abstract types
export function walkSubgraphToCollectObjectLikesAndDirectiveDefinitions(
  factory: FederationFactory,
  subgraph: InternalSubgraph,
) {
  subgraph.definitions = visit(subgraph.definitions, {
    DirectiveDefinition: {
      enter(node) {
        factory.upsertDirectiveNode(node);
      },
    },
    InterfaceTypeDefinition: {
      enter(node) {
        const parentTypeName = node.name.value;
        factory.upsertParentNode(node);
        if (!isObjectLikeNodeEntity(node)) {
          return false;
        }
        if (!factory.graph.hasNode(parentTypeName)) {
          factory.graph.addNode(parentTypeName);
        }
      },
    },
    ObjectTypeDefinition: {
      enter(node) {
        const typeName = node.name.value;
        const operationType = subgraph.operationTypes.get(typeName);
        const parentTypeName = operationType
          ? getOrThrowError(operationTypeNodeToDefaultType, operationType, OPERATION_TO_DEFAULT)
          : typeName;
        if (!factory.graph.hasNode(parentTypeName)) {
          factory.graph.addNode(parentTypeName);
        }
        if (isNodeInterfaceObject(node)) {
          return false;
        }
        const entityContainer = factory.entityContainersByTypeName.get(typeName);
        if (entityContainer && !isObjectLikeNodeEntity(node)) {
          factory.validateKeyFieldSetsForImplicitEntity(entityContainer);
        }
        addConcreteTypesForImplementedInterfaces(node, factory.abstractToConcreteTypeNames);
        if (typeName == parentTypeName) {
          return false;
        }
        factory.renamedTypeNameByOriginalTypeName.set(typeName, parentTypeName);
        return {
          ...node,
          name: stringToNameNode(parentTypeName),
        };
      },
    },
    ObjectTypeExtension: {
      enter(node) {
        const name = node.name.value;
        const operationType = subgraph.operationTypes.get(name);
        const parentTypeName = operationType
          ? getOrThrowError(operationTypeNodeToDefaultType, operationType, OPERATION_TO_DEFAULT)
          : name;
        addConcreteTypesForImplementedInterfaces(node, factory.abstractToConcreteTypeNames);
        if (!factory.graph.hasNode(parentTypeName)) {
          factory.graph.addNode(parentTypeName);
        }
        if (name !== parentTypeName) {
          return {
            ...node,
            name: stringToNameNode(parentTypeName),
          };
        }
        return false;
      },
    },
    UnionTypeDefinition: {
      enter(node) {
        factory.upsertParentNode(node);
        addConcreteTypesForUnion(node, factory.abstractToConcreteTypeNames);
      },
    },
  });
}

export function walkSubgraphToFederate(
  subgraph: DocumentNode,
  overriddenFieldNamesByParentTypeName: Map<string, Set<string>>,
  factory: FederationFactory,
) {
  let overriddenFieldNames: Set<string> | undefined;
  visit(subgraph, {
    Directive: {
      enter() {
        return false;
      },
    },
    EnumTypeDefinition: {
      enter(node) {
        factory.parentTypeName = node.name.value;
        factory.upsertParentNode(node);
      },
      leave() {
        factory.parentTypeName = '';
      },
    },
    EnumValueDefinition: {
      enter(node) {
        factory.childName = node.name.value;
        factory.upsertValueNode(node);
      },
      leave() {
        factory.childName = '';
      },
    },
    FieldDefinition: {
      enter(node) {
        const fieldName = node.name.value;
        // if the field overridden by another graph, do not upsert it
        if (overriddenFieldNames?.has(fieldName)) {
          return false;
        }
        const fieldPath = `${factory.parentTypeName}.${fieldName}`;
        const fieldNamedTypeName = getNamedTypeForChild(fieldPath, node.type);
        if (factory.isParentRootType && (fieldName === SERVICE_FIELD || fieldName === ENTITIES_FIELD)) {
          return false;
        }
        factory.childName = fieldName;
        factory.upsertFieldNode(node);
        if (!factory.graph.hasNode(factory.parentTypeName) || factory.graphEdges.has(fieldPath)) {
          return;
        }
        factory.graphEdges.add(fieldPath);
        // If the parent node is never an entity, add the child edge
        // Otherwise, only add the child edge if the child is a field on a subgraph where the object is an entity
        // TODO resolvable false
        const entity = factory.entityContainersByTypeName.get(factory.parentTypeName);
        if (entity && !entity.fieldNames.has(fieldName)) {
          return;
        }
        const concreteTypeNames = factory.abstractToConcreteTypeNames.get(fieldNamedTypeName);
        if (concreteTypeNames) {
          for (const concreteTypeName of concreteTypeNames) {
            factory.graph.addEdge(factory.parentTypeName, concreteTypeName);
          }
        }
        if (!factory.graph.hasNode(fieldNamedTypeName)) {
          return;
        }
        factory.graph.addEdge(factory.parentTypeName, fieldNamedTypeName);
      },
      leave() {
        factory.childName = '';
      },
    },
    InputObjectTypeDefinition: {
      enter(node) {
        factory.parentTypeName = node.name.value;
        factory.isParentInputObject = true;
        factory.upsertParentNode(node);
      },
      leave() {
        factory.parentTypeName = '';
        factory.isParentInputObject = false;
      },
    },
    InputValueDefinition: {
      enter(node) {
        if (factory.isParentInputObject) {
          factory.childName = node.name.value;
        }
        factory.upsertValueNode(node);
      },
      leave() {
        if (factory.isParentInputObject) {
          factory.childName = '';
        }
      },
    },
    InterfaceTypeDefinition: {
      enter(node) {
        factory.parentTypeName = node.name.value;
        factory.isCurrentParentInterface = true;
        factory.upsertParentNode(node);
      },
      leave() {
        factory.parentTypeName = '';
        factory.isCurrentParentInterface = false;
      },
    },
    ObjectTypeDefinition: {
      enter(node) {
        factory.areFieldsExternal = isNodeExternal(node);
        factory.areFieldsShareable = !factory.isCurrentSubgraphVersionTwo || isNodeShareable(node);
        factory.isCurrentParentEntity = isObjectLikeNodeEntity(node);
        factory.isParentRootType = factory.isObjectRootType(node);
        factory.parentTypeName = node.name.value;
        if (isNodeInterfaceObject(node)) {
          factory.upsertInterfaceObjectParentNode(node);
          return;
        }
        factory.upsertParentNode(node);
        overriddenFieldNames = overriddenFieldNamesByParentTypeName.get(factory.parentTypeName);
      },
      leave() {
        overriddenFieldNames = undefined;
        factory.areFieldsExternal = false;
        factory.areFieldsShareable = false;
        factory.isCurrentParentEntity = false;
        factory.isParentRootType = false;
        factory.parentTypeName = '';
      },
    },
    ObjectTypeExtension: {
      enter(node) {
        const name = node.name.value;
        factory.areFieldsExternal = isNodeExternal(node);
        factory.areFieldsShareable = !factory.isCurrentSubgraphVersionTwo || isNodeShareable(node);
        factory.isCurrentParentExtensionType = true;
        factory.isCurrentParentEntity = isObjectLikeNodeEntity(node);
        factory.parentTypeName = name;
        factory.isParentRootType = factory.isObjectRootType(node);
        factory.upsertExtensionNode(node);
        overriddenFieldNames = overriddenFieldNamesByParentTypeName.get(factory.parentTypeName);
      },
      leave() {
        overriddenFieldNames = undefined;
        factory.areFieldsExternal = false;
        factory.areFieldsShareable = false;
        factory.isCurrentParentEntity = false;
        factory.isCurrentParentExtensionType = false;
        factory.parentTypeName = '';
        factory.isParentRootType = false;
      },
    },
    ScalarTypeDefinition: {
      enter(node) {
        factory.upsertParentNode(node);
      },
    },
  });
}
