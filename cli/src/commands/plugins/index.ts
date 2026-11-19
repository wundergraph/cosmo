import { Command } from 'commander';
import type { CallerKind, Writable } from '@wundergraph/wgc-plugin-sdk';
import { PluginEnvironment } from '../../core/plugins/environment.js';
import { NpmRunner } from '../../core/plugins/npm.js';
import InstallCommand from './commands/install.js';
import ListCommand from './commands/list.js';
import RemoveCommand from './commands/remove.js';

export interface PluginCommandOptions {
  environment: PluginEnvironment;
  npm: NpmRunner;
  caller: CallerKind;
  stdout?: Writable;
  stderr?: Writable;
}

export default (opts: PluginCommandOptions) => {
  const command = new Command('plugins');
  command.description('Installs, lists and removes wgc plugins, which add top-level commands such as `wgc hub`.');
  command.addCommand(InstallCommand(opts));
  command.addCommand(ListCommand(opts));
  command.addCommand(RemoveCommand(opts));
  return command;
};
