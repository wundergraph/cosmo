import { Command } from 'commander';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import InitPluginCommand from './commands/init.js';
import BuildPluginCommand from './commands/build.js';
import GeneratePluginCommand from './commands/generate.js';
import TestPluginCommand from './commands/test.js';
import CreatePluginCommand from './commands/create.js';
import PublishPluginCommand from './commands/publish.js';
import DeletePluginCommand from './commands/delete.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('plugin');
  command.description('Provides commands for creating and maintaining router plugins');
  command.addCommand(InitPluginCommand(opts));
  command.addCommand(BuildPluginCommand(opts));
  command.addCommand(GeneratePluginCommand(opts));
  command.addCommand(TestPluginCommand(opts));
  command.addCommand(CreatePluginCommand(opts));
  command.addCommand(PublishPluginCommand(opts));
  command.addCommand(DeletePluginCommand(opts));

  return command;
};
