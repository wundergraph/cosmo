import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import InitPluginCommand from './commands/init.js';
import BuildPluginCommand from './commands/build.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('plugin');
  command.description('Provides commands for creating and maintaining router plugins');
  command.addCommand(InitPluginCommand(opts));
  command.addCommand(BuildPluginCommand(opts));

  return command;
};
