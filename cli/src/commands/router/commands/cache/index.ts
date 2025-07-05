import { Command } from 'commander';
import PushCacheOperation from './commands/push.js';
import type { BaseCommandOptions } from '@/core/types';

export default (opts: BaseCommandOptions) => {
  const schema = new Command('cache');
  schema.description(
    'Provides commands for pushing and maintaining router cache warmer operations of a federated graph',
  );

  schema.addCommand(PushCacheOperation(opts));

  return schema;
};
