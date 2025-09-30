import { SubgraphName, TypeName } from '../../types/types';

export type EntityAncestorData = {
  fieldSetsByTargetSubgraphName: Map<SubgraphName, Set<string>>;
  subgraphName: SubgraphName;
  typeName: TypeName;
};

export type EntityAncestorCollection = {
  fieldSetsByTargetSubgraphName: Map<SubgraphName, Set<string>>;
  subgraphNames: Array<SubgraphName>;
  typeName: TypeName;
};

export type SelectionSetSegments = {
  outputEnd: string;
  outputStart: string;
  pathNodes: Array<string>;
};
