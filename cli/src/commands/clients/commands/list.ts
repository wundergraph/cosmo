import { Command } from 'commander';

import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('list');
  command.description('Lists all registered GraphQL clients');
  command.option('-n, --namespace [string]', 'The namespace of the federated graph or monograph.');
  command.option('--format <output-format>', 'Output format: supported ones are text and json', 'text');

  command.action(async (name, options) => {
    return;
  });
  return command;
};
