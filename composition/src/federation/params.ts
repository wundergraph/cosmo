import { type Subgraph } from '../subgraph/types';
import type { CompositionOptions } from '../types/params';
import { type SupportedRouterCompatibilityVersion } from '../router-compatibility-version/router-compatibility-version';
import type { ContractName } from '../types/types';
import { type ContractTagOptions } from './types';

export type FederateSubgraphsParams = {
  subgraphs: Array<Subgraph>;
  options?: CompositionOptions;
  version?: SupportedRouterCompatibilityVersion;
};

export type FederateSubgraphsWithContractsParams = {
  subgraphs: Array<Subgraph>;
  tagOptionsByContractName: Map<ContractName, ContractTagOptions>;
  options?: CompositionOptions;
  version?: SupportedRouterCompatibilityVersion;
};

export type FederateSubgraphsContractParams = {
  contractTagOptions: ContractTagOptions;
  subgraphs: Array<Subgraph>;
  options?: CompositionOptions;
  version?: SupportedRouterCompatibilityVersion;
};
