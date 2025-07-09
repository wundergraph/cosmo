import { Command } from 'commander';
import { checkAuth } from '../auth/utils.js';
import CreateProposalCommand from './commands/create.js';
import UpdateProposalCommand from './commands/update.js';
import type { BaseCommandOptions } from '@/core/types';

export default (opts: BaseCommandOptions) => {
  const command = new Command('proposal');
  command.description('Provides commands for creating and maintaining proposals for a federated graph');
  command.addCommand(CreateProposalCommand(opts));
  command.addCommand(UpdateProposalCommand(opts));

  command.hook('preAction', async (thisCmd) => {
    await checkAuth();
  });

  return command;
};
