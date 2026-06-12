import { type FederationFactory } from './federation-factory';
import {
  type CompositeOutputData,
  type InterfaceDefinitionData,
  type ObjectDefinitionData,
} from '../../schema-building/types/types';
import { type FieldDefinitionNode, Kind } from 'graphql';

// graphql v16's CJS root re-exports enum objects through getters; keep hot walker reads local.
const KindRef = Kind;

import { operationTypeNodeToDefaultType } from '../../ast/utils';
import { renameNamedTypeName } from '../schema-building/type-merging';
import { type InternalSubgraph } from '../../subgraph/types';
import {
  ENTITIES_FIELD,
  OPERATION_TO_DEFAULT,
  PARENT_DEFINITION_DATA,
  SERVICE_FIELD,
} from '../../utils/string-constants';
import { getOrThrowError } from '../../utils/utils';
import { invalidKeyFatalError } from '../../errors/errors';

function visitFieldDefinitionNode(
  ff: FederationFactory,
  subgraph: InternalSubgraph,
  node: FieldDefinitionNode,
  parentData: CompositeOutputData,
  isParentRootType: boolean,
  overriddenFieldNames: Set<string> | undefined,
) {
  const fieldName = node.name.value;
  if (isParentRootType && (fieldName === SERVICE_FIELD || fieldName === ENTITIES_FIELD)) {
    parentData.fieldDataByName.delete(fieldName);
    return;
  }
  const parentTypeName = parentData.name;
  const fieldData = parentData.fieldDataByName.get(fieldName);
  if (fieldData === undefined) {
    throw invalidKeyFatalError(fieldName, `${parentTypeName}.fieldDataByFieldName`);
  }
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
}

export function renameRootTypes(ff: FederationFactory, subgraph: InternalSubgraph) {
  for (const definitionNode of subgraph.definitions.definitions) {
    switch (definitionNode.kind) {
      case KindRef.INTERFACE_TYPE_DEFINITION: {
        const parentTypeName = definitionNode.name.value;
        if (!ff.entityInterfaceFederationDataByTypeName.get(parentTypeName)) {
          break;
        }
        const parentData = getOrThrowError(
          subgraph.parentDefinitionDataByTypeName,
          parentTypeName,
          PARENT_DEFINITION_DATA,
        ) as InterfaceDefinitionData;
        // TODO rename root fields references
        if (definitionNode.fields) {
          for (const fieldNode of definitionNode.fields) {
            visitFieldDefinitionNode(ff, subgraph, fieldNode, parentData, false, undefined);
          }
        }
        break;
      }
      case KindRef.OBJECT_TYPE_DEFINITION: {
        const originalTypeName = definitionNode.name.value;
        const operationType = subgraph.operationTypes.get(originalTypeName);
        const parentTypeName = operationType
          ? getOrThrowError(operationTypeNodeToDefaultType, operationType, OPERATION_TO_DEFAULT)
          : originalTypeName;
        const parentData = getOrThrowError(
          subgraph.parentDefinitionDataByTypeName,
          originalTypeName,
          PARENT_DEFINITION_DATA,
        ) as ObjectDefinitionData;
        const isParentRootType = parentData.isRootType;
        let overriddenFieldNames: Set<string> | undefined;
        if (!ff.entityInterfaceFederationDataByTypeName.get(originalTypeName)) {
          ff.addValidPrimaryKeyTargetsToEntityData(originalTypeName);
          overriddenFieldNames = subgraph.overriddenFieldNamesByParentTypeName.get(parentTypeName);
          if (originalTypeName !== parentTypeName) {
            parentData.name = parentTypeName;
            subgraph.parentDefinitionDataByTypeName.set(parentTypeName, parentData);
            subgraph.parentDefinitionDataByTypeName.delete(originalTypeName);
          }
        }
        if (definitionNode.fields) {
          for (const fieldNode of definitionNode.fields) {
            visitFieldDefinitionNode(ff, subgraph, fieldNode, parentData, isParentRootType, overriddenFieldNames);
          }
        }
        break;
      }
      case KindRef.OBJECT_TYPE_EXTENSION: {
        const originalTypeName = definitionNode.name.value;
        const operationType = subgraph.operationTypes.get(originalTypeName);
        const parentTypeName = operationType
          ? getOrThrowError(operationTypeNodeToDefaultType, operationType, OPERATION_TO_DEFAULT)
          : originalTypeName;
        const parentData = getOrThrowError(
          subgraph.parentDefinitionDataByTypeName,
          originalTypeName,
          PARENT_DEFINITION_DATA,
        ) as ObjectDefinitionData;
        const isParentRootType = parentData.isRootType;
        ff.addValidPrimaryKeyTargetsToEntityData(originalTypeName);
        const overriddenFieldNames = subgraph.overriddenFieldNamesByParentTypeName.get(originalTypeName);
        if (originalTypeName !== parentTypeName) {
          parentData.name = parentTypeName;
          subgraph.parentDefinitionDataByTypeName.set(parentTypeName, parentData);
          subgraph.parentDefinitionDataByTypeName.delete(originalTypeName);
        }
        if (definitionNode.fields) {
          for (const fieldNode of definitionNode.fields) {
            visitFieldDefinitionNode(ff, subgraph, fieldNode, parentData, isParentRootType, overriddenFieldNames);
          }
        }
        break;
      }
    }
  }
}
