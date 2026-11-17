import { Command } from 'commander';
import { BaseCommandOptions } from '../../../../../../core/types/types.js';
import SplunkHec from './commands/splunk-hec.js';

/**
 * An organization has at most one destination. Each destination is a subcommand with its own options, so setting a
 * destination replaces whichever one was configured.
 */
export default (opts: BaseCommandOptions) => {
  const command = new Command('set');
  command.description('Creates or replaces the audit log stream destination.');
  command.addCommand(SplunkHec(opts));
  return command;
};
