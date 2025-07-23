import {
  FederateSubgraphsContractParams,
  FederateSubgraphsParams,
  FederateSubgraphsWithContractsParams,
  FederationResult,
  FederationResultWithContracts,
} from './types';
import {
  federateSubgraphs as federateSubgraphsV1,
  federateSubgraphsContract as federateSubgraphsContractV1,
  federateSubgraphsWithContracts as federateSubgraphsWithContractsV1,
} from '../v1/federation/federation-factory';
import { ROUTER_COMPATIBILITY_VERSION_ONE } from '../router-compatibility-version/router-compatibility-version';

export function federateSubgraphs({
  disableResolvabilityValidation,
  subgraphs,
  version = ROUTER_COMPATIBILITY_VERSION_ONE,
}: FederateSubgraphsParams): FederationResult {
  switch (version) {
    default: {
      return federateSubgraphsV1({ disableResolvabilityValidation, subgraphs });
    }
  }
}

// the flow when publishing a subgraph that also has contracts
export function federateSubgraphsWithContracts({
  disableResolvabilityValidation,
  subgraphs,
  tagOptionsByContractName,
  version = ROUTER_COMPATIBILITY_VERSION_ONE,
}: FederateSubgraphsWithContractsParams): FederationResultWithContracts {
  switch (version) {
    default: {
      return federateSubgraphsWithContractsV1({ disableResolvabilityValidation, subgraphs, tagOptionsByContractName });
    }
  }
}

export function federateSubgraphsContract({
  contractTagOptions,
  disableResolvabilityValidation,
  subgraphs,
  version = ROUTER_COMPATIBILITY_VERSION_ONE,
}: FederateSubgraphsContractParams): FederationResult {
  switch (version) {
    default: {
      return federateSubgraphsContractV1({ disableResolvabilityValidation, subgraphs, contractTagOptions });
    }
  }
}
