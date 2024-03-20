import { Command } from 'commander';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { checkAPIKey } from '../../../utils.js';
import FetchFederatedGraphCommand from '../common/fetch.js';
import GetFederatedGraphChangelog from '../common/changelog.js';
import ListFederatedGraphs from './commands/list.js';
import CheckFederatedGraphCommand from './commands/check.js';
import CreateFederatedGraphCommand from './commands/create.js';
import DeleteFederatedGraphCommand from './commands/delete.js';
import UpdateFederatedGraphCommand from './commands/update.js';
import MoveFederatedGraph from './commands/move.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('federated-graph');
  command.description('Provides commands for creating and managing a federated graph');
  command.addCommand(CreateFederatedGraphCommand(opts));
  command.addCommand(FetchFederatedGraphCommand(opts));
  command.addCommand(DeleteFederatedGraphCommand(opts));
  command.addCommand(UpdateFederatedGraphCommand(opts));
  command.addCommand(CheckFederatedGraphCommand(opts));
  command.addCommand(ListFederatedGraphs(opts));
  command.addCommand(GetFederatedGraphChangelog(opts));
  command.addCommand(MoveFederatedGraph(opts));

  command.hook('preAction', () => {
    checkAPIKey();
  });

  return command;
};
