import type { ContractTagOptions } from '@wundergraph/composition';
import type { RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import type { WundergraphConfig } from '@wundergraph/wgc-plugin-sdk/config';
import { SubgraphMetaData } from './types.js';

export type HandleRouterConfigParams = {
  config: WundergraphConfig;
  inputFileLocation: string;
  options: any;
  routerConfig: RouterConfig;
  subgraphs: SubgraphMetaData[];
  contractTagOptionsByFeatureFlagName?: Map<string, ContractTagOptions>;
};
