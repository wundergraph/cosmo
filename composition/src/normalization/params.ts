import { Subgraph } from '../subgraph/types';
import { SupportedRouterCompatibilityVersion } from '../router-compatibility-version/router-compatibility-version';
import { CompositionOptions } from '../types/params';
import { DocumentNode } from 'graphql';
import { Graph } from '../resolvability-graph/graph';
import { SubgraphName } from '../types/types';

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
