import { Command } from 'commander';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import CreateRouterToken from './commands/create.js';
import ListRouterTokens from './commands/list.js';
import DeleteRouterTokens from './commands/delete.js';

export default (opts: BaseCommandOptions) => {
  const schema = new Command('token');
  schema.description('Provides commands for creating and maintaining router tokens of a federated graph');

  schema.addCommand(CreateRouterToken(opts));
  schema.addCommand(ListRouterTokens(opts));
  schema.addCommand(DeleteRouterTokens(opts));

  return schema;
};
