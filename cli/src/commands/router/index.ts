import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAuth } from '../auth/utils.js';
import ComposeRouterConfig from './commands/compose.js';
import FetchRouterConfig from './commands/fetch.js';
import RouterTokenCommands from './commands/token/index.js';
import DownloadRouterBinaryConfig from './commands/download-binary.js';
import RouterCacheCommands from './commands/cache/index.js';

export default (opts: BaseCommandOptions) => {
  const cmd = new Command('router');
  cmd.description('Provides commands for fetching and composing router configs');
  cmd.addCommand(FetchRouterConfig(opts));
  cmd.addCommand(ComposeRouterConfig(opts));
  cmd.addCommand(
    RouterTokenCommands({
      client: opts.client,
    }),
  );
  cmd.addCommand(DownloadRouterBinaryConfig(opts));
  cmd.addCommand(
    RouterCacheCommands({
      client: opts.client,
    }),
  );

  cmd.hook('preAction', async (thisCmd) => {
    if (['compose', 'download-binary'].includes(thisCmd.args[0])) {
      return;
    }
    await checkAuth();
  });

  return cmd;
};
