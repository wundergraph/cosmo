import { Command } from 'commander';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import PushCacheOperation from './commands/push.js';

export default (opts: BaseCommandOptions) => {
  const schema = new Command('cache');
  schema.description(
    'Provides commands for pushing and maintaining router cache warmer operations of a federated graph',
  );

  schema.addCommand(PushCacheOperation(opts));

  return schema;
};
