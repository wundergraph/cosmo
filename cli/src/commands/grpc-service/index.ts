import { Command } from 'commander';
import generateCommand from './commands/generate.js';
import type { BaseCommandOptions } from '@/core/types';

export default (opts: BaseCommandOptions) => {
  const command = new Command('grpc-service');
  command.description('Manage protobuf schemas for remote gRPC services');
  command.addCommand(generateCommand(opts));

  return command;
};
