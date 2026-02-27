import { FieldName, NodeName, SelectionPath, SubgraphName } from '../../../types/types';
import { Edge, GraphNode } from '../../../graph-nodes';
import { NodeResolutionData } from '../../../node-resolution-data/node-resolution-data';

export type EntityWalkerParams = {
  encounteredEntityNodeNames: Set<NodeName>;
  index: number;
  resDataByNodeName: Map<NodeName, NodeResolutionData>;
  resDataByRelativeOriginPath: Map<SelectionPath, NodeResolutionData>;
  resolvedPaths: Set<SelectionPath>;
  subgraphNameByUnresolvablePath: Map<SelectionPath, SubgraphName>;
  visitedEntities: Set<NodeName>;
  relativeOriginPaths?: Set<SelectionPath>;
};

export type VisitEntityDescendantEdgeParams = {
  edge: Edge;
  selectionPath: SelectionPath;
};

export type VisitEntityDescendantNodeParams = {
  node: GraphNode;
  selectionPath: SelectionPath;
};

export type PropagateVisitedFieldParams = {
  areDescendantsResolved: boolean;
  data: NodeResolutionData;
  fieldName: FieldName;
  node: GraphNode;
  selectionPath: SelectionPath;
  visited: boolean;
  isExternal?: true;
};

export type GetNodeResolutionDataParams = {
  node: GraphNode;
  selectionPath: SelectionPath;
};

export type AddUnresolvablePathsParams = {
  selectionPath: SelectionPath;
  subgraphName: SubgraphName;
};

export type RemoveUnresolvablePathsParams = {
  selectionPath: SelectionPath;
  removeDescendantPaths?: boolean;
};
