import type { RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { Config, SubgraphMetaData } from './types.js';

export type HandleRouterConfigParams = {
  config: Config;
  inputFileLocation: string;
  options: any;
  routerConfig: RouterConfig;
  subgraphs: SubgraphMetaData[];
};
