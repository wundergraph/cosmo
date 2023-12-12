import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAPIKey } from '../../utils.js';
import IntrospectOpenApi from './commands/openapi.js';

export default (opts: BaseCommandOptions) => {
  const schema = new Command('introspect');
  schema.description('Provides commands for introspecting and adding external data sources to a federated graph');
  schema.addCommand(IntrospectOpenApi(opts));

  // schema.hook('preAction', () => {
  //   checkAPIKey();
  // });

  return schema;
};
