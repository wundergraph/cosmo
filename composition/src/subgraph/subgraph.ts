import { DocumentNode, GraphQLSchema, OperationTypeNode, visit } from 'graphql';
import { FederationFactory } from '../federation/federation-factory';
import {
  addConcreteTypesForImplementedInterfaces,
  addConcreteTypesForUnion,
  isNodeExternal, isNodeInterfaceObject,
  isNodeShareable,
  isObjectLikeNodeEntity,
  operationTypeNodeToDefaultType,
  stringToNameNode,
} from '../ast/utils';
import { getNamedTypeForChild } from '../type-merging/type-merging';
import { EntityInterfaceData, getOrThrowError } from '../utils/utils';
import { ENTITIES, ENTITIES_FIELD, OPERATION_TO_DEFAULT, SERVICE_FIELD } from '../utils/string-constants';
import { ConfigurationDataMap } from './field-configuration';

export type Subgraph = {
  definitions: DocumentNode;
  name: string;
  url: string;
};

export type InternalSubgraph = {
  configurationDataMap: ConfigurationDataMap;
  definitions: DocumentNode;
  entityInterfaces: Map<string, EntityInterfaceData>;
  isVersionTwo: boolean;
  keyFieldsByParentTypeName: Map<string, Set<string>>;
  name: string;
  operationTypes: Map<string, OperationTypeNode>;
  overriddenFieldNamesByParentTypeName: Map<string, Set<string>>;
  schema: GraphQLSchema;
  url: string;
};

export type SubgraphConfig = {
  configurationDataMap: ConfigurationDataMap;
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
        if (!factory.graph.hasNode(parentTypeName)) {
          factory.graph.addNode(parentTypeName);
        }
        if (isObjectLikeNodeEntity(node)) {
          factory.upsertEntity(node);
        }
      },
    },
    ObjectTypeDefinition: {
      enter(node) {
        const name = node.name.value;
        const operationType = subgraph.operationTypes.get(name);
        const parentTypeName = operationType
          ? getOrThrowError(operationTypeNodeToDefaultType, operationType, OPERATION_TO_DEFAULT) : name;
        addConcreteTypesForImplementedInterfaces(node, factory.abstractToConcreteTypeNames);
        if (isNodeInterfaceObject(node)) {
          return;
        }
        if (!factory.graph.hasNode(parentTypeName)) {
          factory.graph.addNode(parentTypeName);
        }
        if (isObjectLikeNodeEntity(node)) {
          factory.upsertEntity(node);
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
    ObjectTypeExtension: {
      enter(node) {
        const name = node.name.value;
        const operationType = subgraph.operationTypes.get(name);
        const parentTypeName = operationType
          ? getOrThrowError(operationTypeNodeToDefaultType, operationType, OPERATION_TO_DEFAULT) : name;
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
        if (isObjectLikeNodeEntity(node)) {
          factory.upsertEntity(node);
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

export function walkSubgraphToCollectFields(
  factory: FederationFactory,
  subgraph: InternalSubgraph,
) {
  let isCurrentParentRootType = false;
  let overriddenFieldNames: Set<string> | undefined;
  visit(subgraph.definitions, {
    ObjectTypeDefinition: {
      enter(node) {
        isCurrentParentRootType = factory.isObjectRootType(node);
        factory.isCurrentParentEntity = isObjectLikeNodeEntity(node);
        factory.parentTypeName = node.name.value;
        overriddenFieldNames = subgraph.overriddenFieldNamesByParentTypeName.get(factory.parentTypeName);
      },
      leave() {
        isCurrentParentRootType = false;
        overriddenFieldNames = undefined;
        factory.parentTypeName = '';
        factory.isCurrentParentEntity = false;
      },
    },
    ObjectTypeExtension: {
      enter(node) {
        factory.isCurrentParentEntity = isObjectLikeNodeEntity(node);
        factory.parentTypeName = node.name.value;
        overriddenFieldNames = subgraph.overriddenFieldNamesByParentTypeName.get(factory.parentTypeName);
      },
      leave() {
        overriddenFieldNames = undefined;
        factory.isCurrentParentEntity = false;
        factory.parentTypeName = '';
      },
    },
    FieldDefinition: {
      enter(node) {
        const fieldName = node.name.value;
        if (overriddenFieldNames?.has(fieldName)) {
          return false;
        }
        if (factory.isCurrentParentEntity) {
          const entity = getOrThrowError(factory.entities, factory.parentTypeName, ENTITIES);
          entity.fields.add(fieldName);
        }
        return false;
      },
    },
    InterfaceTypeDefinition: {
      enter(node) {
        factory.isCurrentParentEntity = isObjectLikeNodeEntity(node);
        if (!factory.isCurrentParentEntity) {
          return false;
        }
        factory.parentTypeName = node.name.value;
      },
      leave() {
        factory.isCurrentParentEntity = false;
        factory.parentTypeName = '';
      }
    },
  });
}

export function walkSubgraphToFederate(
  subgraph: DocumentNode, overriddenFieldNamesByParentTypeName: Map<string, Set<string>>, factory: FederationFactory,
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
        const entity = factory.entities.get(factory.parentTypeName);
        if (entity && !entity.fields.has(fieldName)) {
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
