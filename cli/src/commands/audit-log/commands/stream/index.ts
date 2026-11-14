import { Command } from 'commander';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import Delete from './delete.js';
import SetCommand from './set.js';
import Show from './show.js';
import Test from './test.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('stream');
  command.description('Configures streaming of audit logs to a Splunk HTTP Event Collector (HEC)');
  command.addCommand(Show(opts));
  command.addCommand(SetCommand(opts));
  command.addCommand(Test(opts));
  command.addCommand(Delete(opts));
  return command;
};
