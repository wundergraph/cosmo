import { Edge, GraphNode } from '../graph-nodes';
import type { FieldPath, NodeName, RootCoords, TypeName } from './types';

import { NodeResolutionData } from '../node-resolution-data/node-resolution-data';

export type VisitEdgeParams = {
  edge: Edge;
  fieldPath: FieldPath;
  rootCoords: RootCoords;
};

export type VisitNodeParams = {
  node: GraphNode;
  fieldPath: FieldPath;
  rootCoords: RootCoords;
};

export type ValidateEntityDescendantEdgeParams = {
  edge: Edge;
  fieldPath: FieldPath;
  nodeResolutionDataByTypeName: Map<TypeName, NodeResolutionData>;
}

export type ValidateEntityDescendantNodeParams = {
  fieldPath: FieldPath;
  node: GraphNode;
  nodeResolutionDataByTypeName: Map<TypeName, NodeResolutionData>;
}

export type WalkerParams = {
  entityNodeNamesBySharedFieldPath: Map<string, Set<string>>;
  interSubgraphNodes: Array<GraphNode>;
  nodeResolutionDataByNodeName: Map<NodeName, NodeResolutionData>;
  nodeResolutionDataByTypeNameByEntityNodeName: Map<NodeName, Map<TypeName, NodeResolutionData>>;
  originNode: GraphNode;
  resolvableFieldNamesByRelativeFieldPathByEntityNodeName: Map<string, Map<string, NodeResolutionData>>;
  unresolvableSharedFieldPaths: Set<string>;
  walkerIndex: number;
  sharedResolvableFieldNamesByRelativeFieldPath?: Map<string, NodeResolutionData>;
};