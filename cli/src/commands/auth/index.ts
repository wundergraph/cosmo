import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import Whoami from './commands/whoami.js';
import Login from './commands/login.js';

export default (opts: BaseCommandOptions) => {
  const schema = new Command('auth');
  schema.description('Provides commands for authentication.');
  schema.addCommand(Whoami(opts));
  schema.addCommand(Login(opts));
  return schema;
};
