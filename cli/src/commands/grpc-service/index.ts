import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import generateCommand from './commands/generate.js';
import initCommand from './commands/init.js';
import listTemplatesCommand from './commands/list-templates.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('grpc-service');
  command.description('Manage protobuf schemas for remote gRPC services');
  command.addCommand(generateCommand(opts));
  command.addCommand(initCommand(opts));
  command.addCommand(listTemplatesCommand(opts));

  return command;
};
