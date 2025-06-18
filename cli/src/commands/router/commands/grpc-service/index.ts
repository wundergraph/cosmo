import { Command } from 'commander';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import generateCommand from './commands/generate.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('grpc-service');
  command.alias('service');
  command.description('manage protobuf schemas for standalone grpc subgraphs');
  command.addCommand(generateCommand(opts));

  return command;
};
