import { FederationFactory } from './federation-factory';
import { InternalSubgraph } from '../subgraph/subgraph';
import {
  InterfaceDefinitionData,
  ObjectDefinitionData,
  ParentWithFieldsData,
} from '../schema-building/type-definition-data';
import { visit } from 'graphql';
import { ENTITIES_FIELD, OPERATION_TO_DEFAULT, SERVICE_FIELD } from '../utils/string-constants';
import { getOrThrowError } from '../utils/utils';
import { operationTypeNodeToDefaultType } from '../ast/utils';
import { ObjectExtensionData } from '../schema-building/type-extension-data';
import { renameNamedTypeName } from '../schema-building/type-merging';

export function createMultiGraphAndRenameRootTypes(ff: FederationFactory, subgraph: InternalSubgraph) {
  let parentData: ParentWithFieldsData | undefined;
  let isParentRootType = false;
  let overriddenFieldNames: Set<string> | undefined;
  visit(subgraph.definitions, {
    FieldDefinition: {
      enter(node) {
        const fieldName = node.name.value;
        if (isParentRootType && (fieldName === SERVICE_FIELD || fieldName === ENTITIES_FIELD)) {
          parentData!.fieldDataByFieldName.delete(fieldName);
          return false;
        }
        const parentTypeName = parentData!.name;
        const fieldData = getOrThrowError(
          parentData!.fieldDataByFieldName,
          fieldName,
          `${parentTypeName}.fieldDataByFieldName`,
        );
        const operationType = subgraph.operationTypes.get(fieldData.namedTypeName);
        if (operationType) {
          const defaultTypeName = getOrThrowError(operationTypeNodeToDefaultType, operationType, OPERATION_TO_DEFAULT);
          if (fieldData.namedTypeName !== defaultTypeName) {
            renameNamedTypeName(fieldData, defaultTypeName, ff.errors);
          }
        }
        if (overriddenFieldNames?.has(fieldName)) {
          // overridden fields should not trigger shareable errors
          fieldData.isShareableBySubgraphName.delete(subgraph.name);
          return false;
        }
        const fieldPath = `${parentTypeName}.${fieldName}`;
        if (!ff.graph.hasNode(parentData!.name) || ff.graphEdges.has(fieldPath)) {
          return false;
        }
        ff.graphEdges.add(fieldPath);
        // If the parent node is never an entity, add the child edge
        // Otherwise, only add the child edge if the child is a field on a subgraph where the object is an entity
        // TODO resolvable false
        const entity = ff.entityContainersByTypeName.get(parentTypeName);
        if (entity && !entity.fieldNames.has(fieldName)) {
          return false;
        }
        const concreteTypeNames = ff.concreteTypeNamesByAbstractTypeName.get(fieldData.namedTypeName);
        if (concreteTypeNames) {
          for (const concreteTypeName of concreteTypeNames) {
            ff.graph.addEdge(parentTypeName, concreteTypeName);
          }
        }
        if (!ff.graph.hasNode(fieldData.namedTypeName)) {
          return;
        }
        ff.graph.addEdge(parentTypeName, fieldData.namedTypeName);
      },
    },
    InterfaceTypeDefinition: {
      enter(node) {
        const parentTypeName = node.name.value;
        if (!ff.entityInterfaceFederationDataByTypeName.get(parentTypeName)) {
          return false;
        }
        parentData = getOrThrowError(
          subgraph.parentDefinitionDataByTypeName,
          parentTypeName,
          'parentDefinitionDataByTypeName',
        ) as InterfaceDefinitionData;
        // TODO rename root fields references
      },
      leave() {
        parentData = undefined;
      },
    },
    ObjectTypeDefinition: {
      enter(node) {
        const originalTypeName = node.name.value;
        const operationType = subgraph.operationTypes.get(originalTypeName);
        const parentTypeName = operationType
          ? getOrThrowError(operationTypeNodeToDefaultType, operationType, OPERATION_TO_DEFAULT)
          : originalTypeName;
        parentData = getOrThrowError(
          subgraph.parentDefinitionDataByTypeName,
          originalTypeName,
          'parentDefinitionDataByTypeName',
        ) as ObjectDefinitionData;
        isParentRootType = parentData.isRootType;
        if (ff.entityInterfaceFederationDataByTypeName.get(originalTypeName)) {
          return;
        }
        const entityContainer = ff.entityContainersByTypeName.get(originalTypeName);
        if (entityContainer && !parentData.isEntity) {
          ff.validateKeyFieldSetsForImplicitEntity(entityContainer);
        }
        overriddenFieldNames = subgraph.overriddenFieldNamesByParentTypeName.get(originalTypeName);
        if (originalTypeName === parentTypeName) {
          return;
        }
        parentData.name = parentTypeName;
        subgraph.parentDefinitionDataByTypeName.set(parentTypeName, parentData);
        subgraph.parentDefinitionDataByTypeName.delete(originalTypeName);
      },
      leave() {
        parentData = undefined;
        isParentRootType = false;
        overriddenFieldNames = undefined;
      },
    },
    ObjectTypeExtension: {
      enter(node) {
        const originalTypeName = node.name.value;
        const operationType = subgraph.operationTypes.get(originalTypeName);
        const parentTypeName = operationType
          ? getOrThrowError(operationTypeNodeToDefaultType, operationType, OPERATION_TO_DEFAULT)
          : originalTypeName;
        parentData = getOrThrowError(
          subgraph.parentExtensionDataByTypeName,
          originalTypeName,
          'parentDefinitionDataByTypeName',
        ) as ObjectExtensionData;
        isParentRootType = parentData.isRootType;
        overriddenFieldNames = subgraph.overriddenFieldNamesByParentTypeName.get(originalTypeName);
        if (originalTypeName === parentTypeName) {
          return;
        }
        parentData.name = parentTypeName;
        subgraph.parentExtensionDataByTypeName.set(parentTypeName, parentData);
        subgraph.parentExtensionDataByTypeName.delete(originalTypeName);
      },
      leave() {
        parentData = undefined;
        isParentRootType = false;
        overriddenFieldNames = undefined;
      },
    },
  });
}
