import type { NodeName, RootFieldData, SelectionPath, SubgraphName } from './types';

import { NodeResolutionData } from '../node-resolution-data/node-resolution-data';
import { RootFieldWalker } from '../walker/root-field-walkers/root-field-walker';

export type VisitEntityParams = {
  encounteredEntityNodeNames: Set<NodeName>;
  entityNodeName: NodeName;
  resDataByRelativeOriginPath: Map<SelectionPath, NodeResolutionData>;
  subgraphNameByUnresolvablePath: Map<SelectionPath, SubgraphName>;
  visitedEntities: Set<NodeName>;
  relativeOriginPaths?: Set<SelectionPath>;
};

export type ValidateEntitiesParams = {
  isSharedRootField: boolean;
  rootFieldData: RootFieldData;
  walker: RootFieldWalker;
};

export type ConsolidateUnresolvablePathsParams = {
  pathFromRoot: SelectionPath;
  resDataByRelativeOriginPath: Map<SelectionPath, NodeResolutionData>;
  subgraphNameByUnresolvablePath: Map<SelectionPath, SubgraphName>;
  walker: RootFieldWalker;
};
