import { type SubgraphName, type TypeName } from '../../types/types';

export type EntityAncestorData = {
  fieldSetsByTargetSubgraphName: Map<SubgraphName, Set<string>>;
  subgraphName: SubgraphName;
  typeName: TypeName;
};

export type EntityAncestorCollection = {
  fieldSetsByTargetSubgraphName: Map<SubgraphName, Set<string>>;
  sourceSubgraphNamesBySatisfiedFieldSet: Map<string, Array<SubgraphName>>;
  subgraphNames: Array<SubgraphName>;
  typeName: TypeName;
};

export type SelectionSetSegments = {
  outputEnd: string;
  outputStart: string;
  pathNodes: Array<string>;
};
