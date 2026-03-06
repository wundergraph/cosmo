import type { Subgraph } from '../subgraph/types';
import type { SupportedRouterCompatibilityVersion } from '../router-compatibility-version/router-compatibility-version';
import type { CompositionOptions } from '../types/params';
import type { DocumentNode } from 'graphql';
import type { Graph } from '../resolvability-graph/graph';
import type { SubgraphName } from '../types/types';

export type BatchNormalizeParams = {
  subgraphs: Array<Subgraph>;
  options?: CompositionOptions;
  version?: SupportedRouterCompatibilityVersion;
};

export type NormalizeSubgraphParams = {
  document: DocumentNode;
  internalGraph?: Graph;
  options?: CompositionOptions;
  subgraphName?: SubgraphName;
  version?: SupportedRouterCompatibilityVersion;
};

export type NormalizeSubgraphFromStringParams = {
  sdlString: string;
  noLocation?: boolean;
  options?: CompositionOptions;
  version?: SupportedRouterCompatibilityVersion;
};
