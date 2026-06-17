import { Config, SubgraphMetaData } from './types';
import { RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';

export type HandleRouterConfigParams = {
  config: Config;
  inputFileLocation: string;
  options: any;
  routerConfig: RouterConfig;
  subgraphs: SubgraphMetaData[];
};
