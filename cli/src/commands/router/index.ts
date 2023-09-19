import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAPIKey } from '../../utils.js';
import ComposeRouterConfig from './commands/compose.js';
import FetchRouterConfig from './commands/fetch.js';

export default (opts: BaseCommandOptions) => {
  const cmd = new Command('router');
  cmd.description('Provides commands for fetching and composing router configs');
  cmd.addCommand(FetchRouterConfig(opts));
  cmd.addCommand(ComposeRouterConfig(opts));

  cmd.hook('preAction', (thisCmd) => {
    if (thisCmd.args.includes('compose')) {
      return;
    }
    checkAPIKey();
  });

  return cmd;
};
