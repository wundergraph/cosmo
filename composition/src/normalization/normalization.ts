import {
  batchNormalize as batchNormalizeV1,
  normalizeSubgraph as normalizeSubgraphV1,
  normalizeSubgraphFromString as normalizeSubgraphFromStringV1,
} from '../v1/normalization/normalization-factory';
import {
  ROUTER_COMPATIBILITY_VERSION_ONE,
  SupportedRouterCompatibilityVersion,
} from '../router-compatibility-version/router-compatibility-version';
import { BatchNormalizationResult, NormalizationResult } from './types';
import { DocumentNode } from 'graphql';
import { Graph } from '../resolvability-graph/graph';
import { Subgraph } from '../subgraph/types';

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

export function batchNormalize(
  subgraphs: Array<Subgraph>,
  version: SupportedRouterCompatibilityVersion = ROUTER_COMPATIBILITY_VERSION_ONE,
): BatchNormalizationResult {
  switch (version) {
    default: {
      return batchNormalizeV1(subgraphs);
    }
  }
}
