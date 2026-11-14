import { Command } from 'commander';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import Delete from './commands/delete.js';
import SetCommand from './commands/set/index.js';
import Show from './commands/show.js';
import Test from './commands/test.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('stream');
  command.description(
    "Configures where the organization's audit logs are streamed. Only Splunk HEC is supported for now.",
  );
  command.addCommand(Show(opts));
  command.addCommand(SetCommand(opts));
  command.addCommand(Test(opts));
  command.addCommand(Delete(opts));
  return command;
};
