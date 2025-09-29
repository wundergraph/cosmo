import type { NodeName, RootFieldData, SelectionPath, SubgraphName } from '../../types/types';
import { NodeResolutionData } from '../../node-resolution-data/node-resolution-data';

import { EntityAncestorData } from './types';

export type EntityResolvabilityErrorsParams = {
  entityNodeName: NodeName;
  pathFromRoot: SelectionPath;
  rootFieldData: RootFieldData;
  subgraphNameByUnresolvablePath: Map<SelectionPath, SubgraphName>;
};

export type RootResolvabilityErrorsParams = {
  resDataByPath: Map<SelectionPath, NodeResolutionData>;
  rootFieldData: RootFieldData;
  unresolvablePaths: Iterable<SelectionPath>;
};

export type ResolvabilityErrorsParams = {
  entityAncestorData: EntityAncestorData;
  resDataByPath: Map<SelectionPath, NodeResolutionData>;
  rootFieldData: RootFieldData;
  subgraphNameByUnresolvablePath: Map<SelectionPath, SubgraphName>;
  pathFromRoot?: SelectionPath;
};

export type GetMultipliedRelativeOriginPathsParams = {
  selectionPath: SelectionPath;
  relativeOriginPaths?: Set<SelectionPath>;
};
