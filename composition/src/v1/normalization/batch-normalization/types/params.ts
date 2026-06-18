import { type FieldName, type SubgraphName, type TypeName } from '../../../../types/types';

export type HandleOverridesParams = {
  originalTypeNameByRenamedTypeName: Map<TypeName, TypeName>;
  overriddenFieldNamesByParentTypeNameByTargetSubgraphName: Map<SubgraphName, Map<TypeName, Set<FieldName>>>;
  subgraphName: SubgraphName;
};
