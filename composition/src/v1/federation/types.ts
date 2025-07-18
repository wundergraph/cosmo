import type { Subgraph } from '../../subgraph/types';
import { ContractTagOptions } from '../../federation/types';
import { ContractName } from '../../types/types';

export type FederationParams = {
  subgraphs: Array<Subgraph>;
  disableResolvabilityValidation?: boolean;
};

export type FederateSubgraphsWithContractsV1Params = {
  subgraphs: Array<Subgraph>;
  tagOptionsByContractName: Map<ContractName, ContractTagOptions>;
  disableResolvabilityValidation?: boolean;
};

export type FederateSubgraphsContractV1Params = {
  subgraphs: Array<Subgraph>;
  contractTagOptions: ContractTagOptions;
  disableResolvabilityValidation?: boolean;
};
