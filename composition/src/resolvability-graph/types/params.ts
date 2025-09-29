import type { NodeName, SelectionPath, SubgraphName } from './types';

import { NodeResolutionData } from '../node-resolution-data/node-resolution-data';

export type VisitEntityParams = {
  encounteredEntityNodeNames: Set<NodeName>;
  entityNodeName: NodeName;
  resDataByRelativeOriginPath: Map<SelectionPath, NodeResolutionData>;
  subgraphNameByUnresolvablePath: Map<SelectionPath, SubgraphName>;
  visitedEntities: Set<NodeName>;
  relativeOriginPaths?: Set<SelectionPath>;
};
