import { Command } from 'commander';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import ListCompatibilityVersions from './commands/list.js';

export default (opts: BaseCommandOptions) => {
  const schema = new Command('compatibility-version');
  schema.description('Provides commands for router compatibility versions.');

  schema.addCommand(ListCompatibilityVersions(opts));

  return schema;
};
