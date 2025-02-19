import { Subgraph } from '../subgraph/types';
import { ContractTagOptions, FederationResult, FederationResultWithContracts } from './types';
import {
  federateSubgraphs as federateSubgraphsV1,
  federateSubgraphsContract as federateSubgraphsContractV1,
  federateSubgraphsWithContracts as federateSubgraphsWithContractsV1,
} from '../v1/federation/federation-factory';
import {
  ROUTER_COMPATIBILITY_VERSION_ONE,
  SupportedRouterCompatibilityVersion,
} from '../router-compatibility-version/router-compatibility-version';

export function federateSubgraphs(
  subgraphs: Array<Subgraph>,
  version: SupportedRouterCompatibilityVersion = ROUTER_COMPATIBILITY_VERSION_ONE,
): FederationResult {
  switch (version) {
    default: {
      return federateSubgraphsV1(subgraphs);
    }
  }
}

// the flow when publishing a subgraph that also has contracts
export function federateSubgraphsWithContracts(
  subgraphs: Subgraph[],
  tagOptionsByContractName: Map<string, ContractTagOptions>,
  version: SupportedRouterCompatibilityVersion = ROUTER_COMPATIBILITY_VERSION_ONE,
): FederationResultWithContracts {
  switch (version) {
    default: {
      return federateSubgraphsWithContractsV1(subgraphs, tagOptionsByContractName);
    }
  }
}

export function federateSubgraphsContract(
  subgraphs: Array<Subgraph>,
  contractTagOptions: ContractTagOptions,
  version: SupportedRouterCompatibilityVersion = ROUTER_COMPATIBILITY_VERSION_ONE,
): FederationResult {
  switch (version) {
    default: {
      return federateSubgraphsContractV1(subgraphs, contractTagOptions);
    }
  }
}
