import { DocumentNode, OperationTypeNode, visit } from 'graphql';
import { FederationFactory } from '../federation/federation-factory';
import {
  getInlineFragmentString,
  isKindAbstract,
  isNodeShareable,
  isObjectLikeNodeEntity,
  operationTypeNodeToDefaultType,
  stringToNameNode,
} from '../ast/utils';
import { getNamedTypeForChild } from '../type-merging/type-merging';
import { getOrThrowError } from '../utils/utils';
import { printTypeNode } from '@graphql-tools/merge';

export type Subgraph = {
  definitions: DocumentNode;
  name: string;
  url: string;
};

export type InternalSubgraph = {
  definitions: DocumentNode;
  isVersionTwo: boolean;
  name: string;
  operationTypes: Map<string, OperationTypeNode>;
  url: string;
};

export function validateSubgraphName(
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
export function walkSubgraphToCollectObjects(
  factory: FederationFactory,
  subgraph: InternalSubgraph,
) {
  subgraph.definitions = visit(subgraph.definitions, {
    InterfaceTypeDefinition: {
      enter(node) {
        factory.upsertParentNode(node);
      },
    },
    ObjectTypeDefinition: {
      enter(node) {
        const name = node.name.value;
        const operationType = subgraph.operationTypes.get(name);
        const parentTypeName = operationType ? getOrThrowError(operationTypeNodeToDefaultType, operationType)
          : name;
        factory.addConcreteTypesForInterface(node);
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
        const parentTypeName = operationType ? getOrThrowError(operationTypeNodeToDefaultType, operationType)
          : name;
        factory.addConcreteTypesForInterface(node);
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
        factory.addConcreteTypesForUnion(node);
      },
    },
  });
}

export function walkSubgraphToCollectOperationsAndFields(
  factory: FederationFactory,
  subgraph: Subgraph,
) {
  let isCurrentParentRootType = false;
  visit(subgraph.definitions, {
    ObjectTypeDefinition: {
      enter(node) {
        isCurrentParentRootType = factory.isObjectRootType(node);
        factory.isCurrentParentEntity = isObjectLikeNodeEntity(node);
        factory.parentTypeName = node.name.value;
      },
      leave() {
        isCurrentParentRootType = false;
        factory.parentTypeName = '';
        factory.isCurrentParentEntity = false;
      },
    },
    ObjectTypeExtension: {
      enter(node) {
        factory.isCurrentParentEntity = isObjectLikeNodeEntity(node);
        factory.parentTypeName = node.name.value;
      },
      leave() {
        factory.isCurrentParentEntity = false;
        factory.parentTypeName = '';
      },
    },
    FieldDefinition: {
      enter(node) {
        const fieldName = node.name.value;
        const fieldPath = `${factory.parentTypeName}.${fieldName}`;
        const fieldRootTypeName = getNamedTypeForChild(fieldPath, node.type);
        // If a node exists in the multigraph, it's a concrete object type
        // Only add the edge if it hasn't already been added through another subgraph
        if (factory.graph.hasNode(fieldRootTypeName) && !factory.graphEdges.has(fieldPath)) {
          factory.graph.addEdge(factory.parentTypeName, fieldRootTypeName, { fieldName });
          factory.graphEdges.add(fieldPath);
        }
        if (factory.isCurrentParentEntity) {
          const entity = getOrThrowError(factory.entityMap, factory.parentTypeName);
          entity.fields.add(fieldName);
        }
        if (!isCurrentParentRootType) {
          // If the response type is a concrete field or the path has already been added, there's nothing further to do
          if (factory.graph.hasNode(fieldRootTypeName) || factory.graphEdges.has(fieldPath)) {
            return false;
          }
          // If the field is an abstract response type, an edge for each concrete response type must be added
          factory.graphEdges.add(fieldPath);
          const concreteTypeNames = factory.abstractToConcreteTypeNames.get(fieldRootTypeName);
          // It is possible for an interface to have no implementers
          if (!concreteTypeNames) {
            return false;
          }
          for (const concreteTypeName of concreteTypeNames) {
            factory.graph.addEdge(factory.parentTypeName, concreteTypeName, {
              fieldName,
              inlineFragment: getInlineFragmentString(concreteTypeName),
            });
          }
          return false;
        }
        // If the operation returns a concrete type, upsert the field
        // This also records the appearance of this field in the current subgraph
        if (factory.graph.hasNode(fieldRootTypeName)) {
          factory.upsertConcreteObjectLikeOperationFieldNode(
            fieldName, fieldRootTypeName, fieldPath, printTypeNode(node.type),
          );
          return false;
        }
        const parentContainer = factory.parentMap.get(fieldRootTypeName);
        // If the field is not an abstract response type, it is not an object-like, so return
        if (!parentContainer || !isKindAbstract(parentContainer.kind)) {
          return false;
        }
        // At his point, it is known that this field is an abstract response type on an operation
        const concreteTypes = factory.abstractToConcreteTypeNames.get(fieldRootTypeName);
        // It is possible for an interface to have no implementers
        if (!concreteTypes) {
          return false;
        }
        // Upsert response types and add edges from the operation to each possible concrete type for the abstract field
        factory.upsertAbstractObjectLikeOperationFieldNode(
          fieldName, fieldRootTypeName, fieldPath, printTypeNode(node.type), concreteTypes
        );
        return false;
      },
    },
    InterfaceTypeDefinition: {
      enter() {
        // skip the interface fields
        return false;
      },
    },
  });
}

export function walkSubgraphToFederate(subgraph: DocumentNode, factory: FederationFactory) {
  visit(subgraph, {
    DirectiveDefinition: {
      enter(node) {
        factory.directiveDefinitions.set(node.name.value, node); // TODO
      },
    },
    Directive: {
      enter() {
        return false; // TODO
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
        factory.childName = node.name.value;
        factory.upsertFieldNode(node);
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
        factory.areFieldsShareable = !factory.isCurrentSubgraphVersionTwo || isNodeShareable(node);
        factory.isCurrentParentEntity = isObjectLikeNodeEntity(node);
        factory.isParentRootType = factory.isObjectRootType(node);
        factory.parentTypeName = node.name.value;
        factory.upsertParentNode(node);
      },
      leave() {
        factory.areFieldsShareable = false;
        factory.isCurrentParentEntity = false;
        factory.isParentRootType = false;
        factory.parentTypeName = '';
      },
    },
    ObjectTypeExtension: {
      enter(node) {
        const name = node.name.value;
        factory.isCurrentParentExtensionType = true;
        factory.isCurrentParentEntity = isObjectLikeNodeEntity(node);
        factory.parentTypeName = name;
        factory.areFieldsShareable =
          !factory.isCurrentSubgraphVersionTwo || isNodeShareable(node);
        factory.isParentRootType = factory.isObjectRootType(node);
        factory.upsertExtensionNode(node);
      },
      leave() {
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
