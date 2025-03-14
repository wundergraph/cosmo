import {
  CompositionError,
  CompositionWarning,
  DeploymentError,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb.js';
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
  compositionWarnings?: CompositionWarning[];
  message: string;
  details?: string;
};

export type WhoAmICommandJsonOutput = {
  status: 'success' | 'error';
  organizationName: string;
  organizationSlug: string;
  apiUrl: string;
  details?: string;
};
