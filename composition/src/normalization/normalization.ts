import {
  batchNormalize as batchNormalizeV1,
  normalizeSubgraph as normalizeSubgraphV1,
  normalizeSubgraphFromString as normalizeSubgraphFromStringV1,
} from '../v1/normalization/normalization-factory';
import { ROUTER_COMPATIBILITY_VERSION_ONE } from '../router-compatibility-version/router-compatibility-version';
import { type BatchNormalizationResult, type NormalizationResult } from './types';
import {
  type BatchNormalizeParams,
  type NormalizeSubgraphFromStringParams,
  type NormalizeSubgraphParams,
} from './params';

export function normalizeSubgraphFromString({
  noLocation = true,
  options,
  sdlString,
  version = ROUTER_COMPATIBILITY_VERSION_ONE,
}: NormalizeSubgraphFromStringParams): NormalizationResult {
  switch (version) {
    default: {
      return normalizeSubgraphFromStringV1({ noLocation, options, sdlString });
    }
  }
}

export function normalizeSubgraph({
  document,
  internalGraph,
  options,
  subgraphName,
  version = ROUTER_COMPATIBILITY_VERSION_ONE,
}: NormalizeSubgraphParams): NormalizationResult {
  switch (version) {
    default: {
      return normalizeSubgraphV1({ document, internalGraph, options, subgraphName });
    }
  }
}

export function batchNormalize({
  options,
  subgraphs,
  version = ROUTER_COMPATIBILITY_VERSION_ONE,
}: BatchNormalizeParams): BatchNormalizationResult {
  switch (version) {
    default: {
      return batchNormalizeV1({ options, subgraphs });
    }
  }
}
