import {
  normalizeSubgraph as normalizeSubgraphV1,
  normalizeSubgraphFromString as normalizeSubgraphFromStringV1,
} from '../v1/normalization/normalization-factory';
import {
  ROUTER_COMPATIBILITY_VERSION_ONE,
  SupportedRouterCompatibilityVersion,
} from '../router-compatibility-version/router-compatibility-version';
import { NormalizationResult } from './types';
import { DocumentNode } from 'graphql';
import { Graph } from '../resolvability-graph/graph';

export function normalizeSubgraphFromString(
  schema: string,
  noLocation = true,
  version: SupportedRouterCompatibilityVersion = ROUTER_COMPATIBILITY_VERSION_ONE,
): NormalizationResult {
  switch (version) {
    default: {
      return normalizeSubgraphFromStringV1(schema, noLocation);
    }
  }
}

export function normalizeSubgraph(
  document: DocumentNode,
  subgraphName?: string,
  internalGraph?: Graph,
  version: SupportedRouterCompatibilityVersion = ROUTER_COMPATIBILITY_VERSION_ONE,
): NormalizationResult {
  switch (version) {
    default: {
      return normalizeSubgraphV1(document, subgraphName, internalGraph);
    }
  }
}
