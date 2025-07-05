import { Command } from 'commander';
import ListCompatibilityVersions from './commands/list.js';
import type { BaseCommandOptions } from '@/core/types';

export default (opts: BaseCommandOptions) => {
  const schema = new Command('compatibility-version');
  schema.description('Provides commands for router compatibility versions.');

  schema.addCommand(ListCompatibilityVersions(opts));

  return schema;
};
