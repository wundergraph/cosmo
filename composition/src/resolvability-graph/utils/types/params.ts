import { NodeName, RootFieldData, SelectionPath, SubgraphName } from '../../types/types';
import { NodeResolutionData } from '../../node-resolution-data/node-resolution-data';

import { EntityAncestorCollection, EntityAncestorData } from './types';
import { UnresolvableFieldData } from '../utils';

export type EntityResolvabilityErrorsParams = {
  entityNodeName: NodeName;
  pathFromRoot: SelectionPath;
  rootFieldData: RootFieldData;
  subgraphNameByUnresolvablePath: Map<SelectionPath, SubgraphName>;
};

export type EntitySharedRootFieldResolvabilityErrorsParams = {
  entityNodeNames: Set<NodeName>;
  pathFromRoot: SelectionPath;
  rootFieldData: RootFieldData;
  resDataByPath: Map<SelectionPath, NodeResolutionData>;
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

export type SharedResolvabilityErrorsParams = {
  entityAncestors: EntityAncestorCollection;
  resDataByPath: Map<SelectionPath, NodeResolutionData>;
  rootFieldData: RootFieldData;
  subgraphNameByUnresolvablePath: Map<SelectionPath, SubgraphName>;
  pathFromRoot?: SelectionPath;
};

export type GetMultipliedRelativeOriginPathsParams = {
  selectionPath: SelectionPath;
  relativeOriginPaths?: Set<SelectionPath>;
};

export type GenerateResolvabilityErrorReasonsParams = {
  rootFieldData: RootFieldData;
  unresolvableFieldData: UnresolvableFieldData;
  entityAncestorData?: EntityAncestorData;
};

export type GenerateSharedResolvabilityErrorReasonsParams = {
  rootFieldData: RootFieldData;
  unresolvableFieldData: UnresolvableFieldData;
  entityAncestors: EntityAncestorCollection;
};
