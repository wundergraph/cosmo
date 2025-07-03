import { BREAK, ConstDirectiveNode, Kind, StringValueNode, visit } from 'graphql';
import { FieldSetConditionData, RequiredFieldConfiguration } from '../../router-configuration/types';
import {
  AuthorizationData,
  CompositeOutputData,
  ConditionalFieldData,
  EntityData,
  EntityInterfaceFederationData,
  FieldData,
  InterfaceDefinitionData,
  ObjectDefinitionData,
  ParentDefinitionData,
} from '../../schema-building/types';
import { Graph } from '../../resolvability-graph/graph';
import { getTypeNodeNamedTypeName, MutableFieldNode } from '../../schema-building/ast';
import { BASE_SCALARS } from '../utils/constants';
import { isKindAbstract } from '../../ast/utils';
import { GraphNode } from '../../resolvability-graph/graph-nodes';

import { Warning } from '../../warnings/types';
import { InternalSubgraph } from '../../subgraph/types';
import { ContractTagOptions } from '../../federation/types';
import { getOrThrowError, getValueOrDefault } from '../../utils/utils';
import { KeyFieldSetData } from '../normalization/types';

export type FederationFactoryParams = {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  entityDataByTypeName: Map<string, EntityData>;
  entityInterfaceFederationDataByTypeName: Map<string, EntityInterfaceFederationData>;
  fieldCoordsByNamedTypeName: Map<string, Set<string>>;
  internalGraph: Graph;
  internalSubgraphBySubgraphName: Map<string, InternalSubgraph>;
  warnings: Warning[];
};

export type ParentTagData = {
  childTagDataByChildName: Map<string, ChildTagData>;
  tagNames: Set<string>;
  typeName: string;
};

export function newParentTagData(typeName: string): ParentTagData {
  return {
    childTagDataByChildName: new Map<string, ChildTagData>(),
    tagNames: new Set<string>(),
    typeName,
  };
}

export type ChildTagData = {
  name: string;
  tagNames: Set<string>;
  tagNamesByArgumentName: Map<string, Set<string>>;
};

export function newChildTagData(name: string): ChildTagData {
  return {
    name,
    tagNames: new Set<string>(),
    tagNamesByArgumentName: new Map<string, Set<string>>(),
  };
}

export type InterfaceImplementationData = {
  data: CompositeOutputData;
  clientSchemaFieldNodes: MutableFieldNode[];
};

export type SubscriptionFilterData = {
  directive: ConstDirectiveNode;
  directiveSubgraphName: string;
  fieldData: FieldData;
};

export type InterfaceObjectForInternalGraphOptions = {
  entityData: EntityData;
  interfaceObjectData: EntityInterfaceFederationData;
  interfaceObjectNode: GraphNode;
  internalSubgraph: InternalSubgraph;
  resolvableKeyFieldSets: Set<string>;
  subgraphName: string;
};

export type VisitFieldSetOptions = {
  conditionalFieldDataByCoords: Map<string, ConditionalFieldData>;
  currentSubgraphName: string;
  entityData: EntityData;
  implicitKeys: Array<RequiredFieldConfiguration>;
  objectData: ObjectDefinitionData | InterfaceDefinitionData;
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>;
  graphNode?: GraphNode;
};

export function validateImplicitFieldSets({
  conditionalFieldDataByCoords,
  currentSubgraphName,
  entityData,
  implicitKeys,
  objectData,
  parentDefinitionDataByTypeName,
  graphNode,
}: VisitFieldSetOptions) {
  const keyFieldSetDataByFieldSet = getValueOrDefault(
    entityData.keyFieldSetDatasBySubgraphName,
    currentSubgraphName,
    () => new Map<string, KeyFieldSetData>(),
  );
  // Only key field sets that are resolvable in at least one subgraph are included here
  for (const [keyFieldSet, documentNode] of entityData.documentNodeByKeyFieldSet) {
    if (keyFieldSetDataByFieldSet.has(keyFieldSet)) {
      continue;
    }
    const parentDatas: Array<CompositeOutputData> = [objectData];
    const definedFields: Array<Set<string>> = [];
    const fieldSetConditions: Array<FieldSetConditionData> = [];
    let currentDepth = -1;
    let shouldDefineSelectionSet = true;
    let shouldAddKeyFieldSet = true;
    visit(documentNode, {
      Argument: {
        enter() {
          // Fields that define arguments are never allowed in a key FieldSet
          // However, at this stage, it actually means the argument is undefined on the field
          shouldAddKeyFieldSet = false;
          return BREAK;
        },
      },
      Field: {
        enter(node) {
          const parentData = parentDatas[currentDepth];
          // If an object-like was just visited, a selection set should have been entered
          if (shouldDefineSelectionSet) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          const fieldName = node.name.value;
          const fieldData = parentData.fieldDataByName.get(fieldName);
          // undefined if the field does not exist on the parent
          if (!fieldData || fieldData.argumentDataByName.size || definedFields[currentDepth].has(fieldName)) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          const { isUnconditionallyProvided } = getOrThrowError(
            fieldData.externalFieldDataBySubgraphName,
            currentSubgraphName,
            `${fieldData.originalParentTypeName}.${fieldName}.externalFieldDataBySubgraphName`,
          );
          const conditionalData = conditionalFieldDataByCoords.get(`${fieldData.renamedParentTypeName}.${fieldName}`);
          if (conditionalData) {
            if (conditionalData.providedBy.length > 0) {
              fieldSetConditions.push(...conditionalData.providedBy);
            } else if (conditionalData.requiredBy.length > 0) {
              shouldAddKeyFieldSet = false;
              return BREAK;
            }
          } else if (!isUnconditionallyProvided) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          // @TODO breaking in V1
          // if (!isUnconditionallyProvided) {
          //   if (!conditionalData || conditionalData.providedBy.length < 1) {
          //     shouldAddKeyFieldSet = false;
          //     return BREAK;
          //   }
          //   fieldSetConditions.push(...conditionalData.providedBy);
          // }
          definedFields[currentDepth].add(fieldName);
          const namedTypeName = getTypeNodeNamedTypeName(fieldData.node.type);
          // The base scalars are not in the parents map
          if (BASE_SCALARS.has(namedTypeName)) {
            return;
          }
          // The child could itself be a parent
          const fieldNamedTypeData = parentDefinitionDataByTypeName.get(namedTypeName);
          if (!fieldNamedTypeData) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          if (fieldNamedTypeData.kind === Kind.OBJECT_TYPE_DEFINITION) {
            shouldDefineSelectionSet = true;
            parentDatas.push(fieldNamedTypeData);
            return;
          }
          // interfaces and unions are invalid in a key directive
          if (isKindAbstract(fieldNamedTypeData.kind)) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
        },
      },
      InlineFragment: {
        enter() {
          shouldAddKeyFieldSet = false;
          return BREAK;
        },
      },
      SelectionSet: {
        enter() {
          if (!shouldDefineSelectionSet) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          currentDepth += 1;
          shouldDefineSelectionSet = false;
          if (currentDepth < 0 || currentDepth >= parentDatas.length) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          definedFields.push(new Set<string>());
        },
        leave() {
          if (shouldDefineSelectionSet) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          // Empty selection sets would be a parse error, so it is unnecessary to handle them
          currentDepth -= 1;
          parentDatas.pop();
          definedFields.pop();
        },
      },
    });
    if (!shouldAddKeyFieldSet) {
      continue;
    }
    implicitKeys.push({
      fieldName: '',
      selectionSet: keyFieldSet,
      ...(fieldSetConditions.length > 0 ? { conditions: fieldSetConditions } : {}),
      disableEntityResolver: true,
    });
    if (graphNode) {
      graphNode.satisfiedFieldSets.add(keyFieldSet);
    }
  }
}

export function newContractTagOptionsFromArrays(
  tagNamesToExclude: Array<string>,
  tagNamesToInclude: Array<string>,
): ContractTagOptions {
  return {
    tagNamesToExclude: new Set<string>(tagNamesToExclude),
    tagNamesToInclude: new Set<string>(tagNamesToInclude),
  };
}

export function getDescriptionFromString(description: string): StringValueNode | undefined {
  if (!description) {
    return;
  }
  return {
    block: true,
    kind: Kind.STRING,
    value: description,
  };
}
