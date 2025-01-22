import { ConstDirectiveNode, DocumentNode, GraphQLSchema } from 'graphql';
import {
  FieldConfiguration,
  FieldSetConditionRouterData,
  newFieldSetConditionData,
  RequiredFieldConfiguration,
} from '../router-configuration/router-configuration';
import { InternalSubgraph, SubgraphConfig } from '../subgraph/subgraph';
import {
  CompositeOutputData,
  FieldData,
  InterfaceDefinitionData,
  ObjectDefinitionData,
  ParentDefinitionData,
} from '../schema-building/type-definition-data';
import {
  AuthorizationData,
  EntityData,
  EntityInterfaceFederationData,
  getOrThrowError,
  getValueOrDefault,
} from '../utils/utils';
import { Graph } from '../resolvability-graph/graph';
import { getTypeNodeNamedTypeName, MutableFieldNode } from '../schema-building/ast';
import { BREAK, Kind, visit } from 'graphql/index';
import { BASE_SCALARS } from '../utils/constants';
import { isKindAbstract } from '../ast/utils';
import { getNormalizedFieldSet, KeyFieldSetData } from '../normalization/utils';
import { GraphNode } from '../resolvability-graph/graph-nodes';
import {
  concatenatePath,
  ConditionalFieldData,
  KeyFieldConditionData,
  newFieldSetConditionRouterData,
} from '../schema-building/utils';
import { Warning } from '../warnings/warnings';
import { PROVIDES, REQUIRES } from '../utils/string-constants';

export type FederationFactoryOptions = {
  authorizationDataByParentTypeName: Map<string, AuthorizationData>;
  concreteTypeNamesByAbstractTypeName: Map<string, Set<string>>;
  entityDataByTypeName: Map<string, EntityData>;
  entityInterfaceFederationDataByTypeName: Map<string, EntityInterfaceFederationData>;
  internalGraph: Graph;
  internalSubgraphBySubgraphName: Map<string, InternalSubgraph>;
  warnings: Warning[];
};

export type FederationResultContainer = {
  warnings: Warning[];
  errors?: Error[];
  federationResult?: FederationResult;
};

export type FederationResult = {
  fieldConfigurations: FieldConfiguration[];
  federatedGraphAST: DocumentNode;
  federatedGraphClientSchema: GraphQLSchema;
  federatedGraphSchema: GraphQLSchema;
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>;
  subgraphConfigBySubgraphName: Map<string, SubgraphConfig>;
  shouldIncludeClientSchema?: boolean;
};

export type FederationResultContainerWithContracts = {
  warnings: Warning[];
  errors?: Error[];
  federationResult?: FederationResult;
  federationResultContainerByContractName?: Map<string, FederationResultContainer>;
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
  entityData: EntityData;
  implicitKeys: Array<RequiredFieldConfiguration>;
  objectData: ObjectDefinitionData | InterfaceDefinitionData;
  parentDefinitionDataByTypeName: Map<string, ParentDefinitionData>;
  subgraphName: string;
  graphNode?: GraphNode;
};

export type ContractTagOptions = {
  tagNamesToExclude: Set<string>;
  tagNamesToInclude: Set<string>;
};

export function newContractTagOptionsFromArrays(
  tagNamesToExclude: Array<string>,
  tagNamesToInclude: Array<string>,
): ContractTagOptions {
  return {
    tagNamesToExclude: new Set<string>(tagNamesToExclude),
    tagNamesToInclude: new Set<string>(tagNamesToInclude),
  };
}

export function getConditionalFieldSetDirectiveName(isProvides: boolean): string {
  if (isProvides) {
    return PROVIDES;
  }
  return REQUIRES;
}

export function validateImplicitKeyFieldSets({
  conditionalFieldDataByCoords,
  entityData,
  graphNode,
  implicitKeys,
  objectData,
  parentDefinitionDataByTypeName,
  subgraphName,
}: VisitFieldSetOptions) {
  const keyFieldSetDataByFieldSet = getValueOrDefault(
    entityData.keyFieldSetDatasBySubgraphName,
    subgraphName,
    () => new Map<string, KeyFieldSetData>(),
  );
  for (const [keyFieldSet, documentNode] of entityData.documentNodeByKeyFieldSet) {
    const keyFieldSetData = keyFieldSetDataByFieldSet.get(keyFieldSet);
    if (keyFieldSetData) {
      continue;
    }
    const parentDatas: CompositeOutputData[] = [objectData];
    const definedFields: Set<string>[] = [];
    const potentialFieldSetConditions = new Map<string, Map<string, KeyFieldConditionData>>();
    const conditionByPreEntityPath = new Map<string, KeyFieldConditionData>();
    let conditionalFieldCount = 0;
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
          // If a composite type was just visited, a selection set should have been entered
          if (shouldDefineSelectionSet) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          const fieldName = node.name.value;
          const fieldData = parentData.fieldDataByFieldName.get(fieldName);
          // undefined if the field does not exist on the parent
          if (
            !fieldData ||
            fieldData.argumentDataByArgumentName.size > 0 ||
            definedFields[currentDepth].has(fieldName)
          ) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          const externalFieldData = getOrThrowError(
            fieldData.isExternalBySubgraphName,
            subgraphName,
            `${fieldData.originalParentTypeName}.${fieldName}.isExternalBySubgraphName`,
          );
          const conditionalData = conditionalFieldDataByCoords.get(`${fieldData.renamedParentTypeName}.${fieldName}`);
          if (!externalFieldData.isUnconditionallyProvided && !conditionalData?.providedBy.length) {
            shouldAddKeyFieldSet = false;
            return BREAK;
          }
          // Whether the field is *ever* satisfiable within the entity.
          let isProvidable = false;
          if (conditionalData) {
            let isUnconditionallyProvided = false;
            for (const fieldSetCondition of conditionalData.providedBy) {
              const parentTypeName = fieldSetCondition.typePath[0];
              /*
               * parentDatas contains each parent type data on the current path within the entity.
               * If one of these parentDatas is the parent of the field that defines @provides for a key field,
               * that key field is provided within the entity itself and can *always* be satisfied within the entity.
               * This means the key field is essentially unconditional in its contribution to an implicit key.
               *  */
              for (let i = 0; i < parentDatas.length; i++) {
                if (parentTypeName === parentDatas[i].name) {
                  isUnconditionallyProvided = true;
                  break;
                }
              }

              for (let i = 1; i < fieldSetCondition.fieldCoordinatesPath.length; i++) {
                const childTypeName = fieldSetCondition.typePath[i];
                if (childTypeName !== objectData.name) {
                  continue;
                }
                isProvidable = true;
                // The @provides path before entering the entity type (start to current depth).
                const preEntityPath = concatenatePath(fieldSetCondition.fieldPath.slice(0, i), parentTypeName);
                // The @provides path after entering the entity type (current depth to end).
                const postEntityPath = concatenatePath(fieldSetCondition.fieldPath.slice(i));
                const condition: KeyFieldConditionData = {
                  fieldCoordinatesPath: fieldSetCondition.fieldCoordinatesPath,
                  preEntityFieldCoordinates: new Set<string>(fieldSetCondition.fieldCoordinatesPath.slice(0, i)),
                  fieldPath: fieldSetCondition.fieldPath,
                  typePath: fieldSetCondition.typePath,
                };
                getValueOrDefault(conditionByPreEntityPath, preEntityPath, () => condition);
                getValueOrDefault(
                  potentialFieldSetConditions,
                  preEntityPath,
                  () => new Map<string, KeyFieldConditionData>(),
                ).set(postEntityPath, condition);
                break;
              }
            }
            if (!isUnconditionallyProvided) {
              if (!isProvidable) {
                shouldAddKeyFieldSet = false;
                return BREAK;
              }
              conditionalFieldCount += 1;
            }
          }
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
    const validFieldSetConditions: Array<FieldSetConditionRouterData> = [];
    for (const [preEntityPath, leafByPostEntityPath] of potentialFieldSetConditions) {
      // It is not yet known whether the current path ia a super-condition or a sub-condition.
      const superCondition = conditionByPreEntityPath.get(preEntityPath);
      if (!superCondition) {
        continue;
      }
      if (leafByPostEntityPath.size === conditionalFieldCount) {
        validFieldSetConditions.push(newFieldSetConditionRouterData(superCondition));
        continue;
      }
      for (const [otherPreEntityPath, otherLeafConditionByPostEntityPath] of potentialFieldSetConditions) {
        // Do not compare a condition to itself.
        if (preEntityPath === otherPreEntityPath) {
          continue;
        }
        const subCondition = conditionByPreEntityPath.get(otherPreEntityPath);
        if (!subCondition) {
          continue;
        }
        /*
         * If the root field coordinates of the potential sub-condition is not within the potential super-condition
         * path, then it cannot be a sub-condition of the potential super-condition.
         */
        if (!superCondition.preEntityFieldCoordinates.has(subCondition.fieldCoordinatesPath[0])) {
          continue;
        }
        // Now that a sub-condition has been determined, add its own provided key fields to the super-condition.
        for (const [postEntityPath, leafCondition] of otherLeafConditionByPostEntityPath) {
          if (!leafByPostEntityPath.get(postEntityPath)) {
            leafByPostEntityPath.set(postEntityPath, leafCondition);
          }
        }
        // If all conditional key fields are provided, the implicit key is satisfied on the super-condition path.
        if (leafByPostEntityPath.size === conditionalFieldCount) {
          validFieldSetConditions.push(newFieldSetConditionData(superCondition));
          break;
        }
      }
    }
    implicitKeys.push({
      fieldName: '',
      selectionSet: keyFieldSet,
      ...(validFieldSetConditions.length > 0 ? { conditions: validFieldSetConditions } : {}),
      ...(keyFieldSetData ? {} : { disableEntityResolver: true }),
    });
    if (graphNode) {
      graphNode.satisfiedFieldSets.add(keyFieldSet);
    }
  }
}
