import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import Whoami from './commands/whoami.js';
import Login from './commands/login.js';
import Logout from './commands/logout.js';
import { checkAuth } from './utils.js';

export default (opts: BaseCommandOptions) => {
  const schema = new Command('auth');
  schema.description('Provides commands for authentication.');
  schema.addCommand(Whoami(opts));
  schema.addCommand(Login(opts));
  schema.addCommand(Logout(opts));

  schema.hook('preAction', async (thisCmd) => {
    if (thisCmd.args[0] === 'login') {
      return;
    }
    await checkAuth();
  });

  return schema;
};
