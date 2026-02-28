import { Edge, GraphNode } from '../../../graph-nodes';
import { FieldName, NodeName, SelectionPath, TypeName } from '../../../types/types';
import { NodeResolutionData } from '../../../node-resolution-data/node-resolution-data';

export type RootFieldWalkerParams = {
  index: number;
  nodeResolutionDataByNodeName: Map<NodeName, NodeResolutionData>;
};

export type VisitEdgeParams = {
  edge: Edge;
  selectionPath: SelectionPath;
};

export type VisitNodeParams = {
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

export type PropagateVisitedSharedFieldParams = {
  areDescendantsResolved: boolean;
  data: NodeResolutionData;
  fieldName: FieldName;
  node: GraphNode;
  visited: boolean;
};

export type VisitRootFieldEdgesParams = {
  edges: Array<Edge>;
  rootTypeName: TypeName;
};

export type GetNodeResolutionDataParams = {
  node: GraphNode;
  selectionPath: SelectionPath;
};
