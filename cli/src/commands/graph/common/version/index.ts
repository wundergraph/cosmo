import { Command } from 'commander';
import { CommonGraphCommandOptions } from '../../../../core/types/types.js';
import GetRouterCompatibilityVersion from './commands/get.js';
import SetRouterCompatibilityVersion from './commands/set.js';

export default (opts: CommonGraphCommandOptions) => {
  const graphType = opts.isMonograph ? 'monograph' : 'federated graph';

  const command = new Command('version');
  command.description(`Provides commands related to the router compatibility version of a ${graphType}.`);
  command.addCommand(GetRouterCompatibilityVersion(opts));
  command.addCommand(SetRouterCompatibilityVersion(opts));

  return command;
};
