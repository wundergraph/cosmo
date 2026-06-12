import { type InternalSubgraph } from './types';
import type { FieldName, TypeName } from '../types/types';
import { type InternalSubgraphFromNormalizationParams } from './types/params';

export function internalSubgraphFromNormalization({
  normalization,
  subgraphName,
}: InternalSubgraphFromNormalizationParams): InternalSubgraph {
  return {
    conditionalFieldDataByCoords: normalization.conditionalFieldDataByCoordinates,
    configurationDataByTypeName: normalization.configurationDataByTypeName,
    costs: normalization.costs,
    definitions: normalization.subgraphAST,
    directiveDefinitionByName: normalization.directiveDefinitionByName,
    entityInterfaceSubgraphDataByTypeName: normalization.entityInterfaces,
    federatedDirectiveDataByName: normalization.federatedDirectiveDataByName,
    isVersionTwo: normalization.isVersionTwo,
    keyFieldNamesByParentTypeName: normalization.keyFieldNamesByParentTypeName,
    name: subgraphName,
    operationTypes: normalization.operationTypes,
    overriddenFieldNamesByParentTypeName: new Map<TypeName, Set<FieldName>>(),
    parentDefinitionDataByTypeName: normalization.parentDefinitionDataByTypeName,
    get schema() {
      // Defers (memoized) schema construction until the schema is actually accessed.
      return normalization.schema;
    },
    schemaNode: normalization.schemaNode,
  };
}
