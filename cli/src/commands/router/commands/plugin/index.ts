import { Command } from 'commander';
import InitPluginCommand from './commands/init.js';
import BuildPluginCommand from './commands/build.js';
import TestPluginCommand from './commands/test.js';
import type { BaseCommandOptions } from '@/core/types';

export default (opts: BaseCommandOptions) => {
  const command = new Command('plugin');
  command.description('Provides commands for creating and maintaining router plugins');
  command.addCommand(InitPluginCommand(opts));
  command.addCommand(BuildPluginCommand(opts));
  command.addCommand(TestPluginCommand(opts));

  return command;
};
