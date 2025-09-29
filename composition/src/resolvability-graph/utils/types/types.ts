import { SubgraphName, TypeName } from '../../types/types';

export type EntityAncestorData = {
  fieldSetsByTargetSubgraphName: Map<SubgraphName, Set<string>>;
  subgraphName: SubgraphName;
  typeName: TypeName;
};
