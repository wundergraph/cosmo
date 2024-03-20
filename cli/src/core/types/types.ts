import { Client } from '../client/client.js';

export interface BaseCommandOptions {
  client: Client;
}

export type CommonGraphCommandOptions = BaseCommandOptions & {
  isMonograph?: boolean;
};
