import { FederationFactory } from './federation-factory';
import { CompositeOutputData, InterfaceDefinitionData, ObjectDefinitionData } from '../../schema-building/types';
import { visit } from 'graphql';
import { operationTypeNodeToDefaultType } from '../../ast/utils';
import { renameNamedTypeName } from '../schema-building/type-merging';
import { InternalSubgraph } from '../../subgraph/types';
import {
  ENTITIES_FIELD,
  OPERATION_TO_DEFAULT,
  PARENT_DEFINITION_DATA,
  SERVICE_FIELD,
} from '../../utils/string-constants';
import { getOrThrowError } from '../../utils/utils';

export function renameRootTypes(ff: FederationFactory, subgraph: InternalSubgraph) {
  let parentData: CompositeOutputData | undefined;
  let isParentRootType = false;
  let overriddenFieldNames: Set<string> | undefined;
  visit(subgraph.definitions, {
    FieldDefinition: {
      enter(node) {
        const fieldName = node.name.value;
        if (isParentRootType && (fieldName === SERVICE_FIELD || fieldName === ENTITIES_FIELD)) {
          parentData!.fieldDataByName.delete(fieldName);
          return false;
        }
        const parentTypeName = parentData!.name;
        const fieldData = getOrThrowError(
          parentData!.fieldDataByName,
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
        }
        return false;
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
          PARENT_DEFINITION_DATA,
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
          PARENT_DEFINITION_DATA,
        ) as ObjectDefinitionData;
        isParentRootType = parentData.isRootType;
        if (ff.entityInterfaceFederationDataByTypeName.get(originalTypeName)) {
          return;
        }
        ff.addValidPrimaryKeyTargetsToEntityData(originalTypeName);
        overriddenFieldNames = subgraph.overriddenFieldNamesByParentTypeName.get(parentTypeName);
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
          subgraph.parentDefinitionDataByTypeName,
          originalTypeName,
          PARENT_DEFINITION_DATA,
        ) as ObjectDefinitionData;
        isParentRootType = parentData.isRootType;
        ff.addValidPrimaryKeyTargetsToEntityData(originalTypeName);
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
  });
}
