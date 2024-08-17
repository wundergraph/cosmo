import { CompositionError, DeploymentError } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb.js';
import { Client } from '../client/client.js';

export interface BaseCommandOptions {
  client: Client;
}

export type CommonGraphCommandOptions = BaseCommandOptions & {
  isMonograph?: boolean;
};

export type SubgraphCommandJsonOutput = {
  status: 'success' | 'error';
  compositionErrors: CompositionError[];
  deploymentErrors: DeploymentError[];
  message: string;
  details?: string;
};
