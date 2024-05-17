import { Command } from 'commander';
import { BaseCommandOptions } from '../../../core/types/types.js';
import GetFederatedGraphChangelog from '../common/changelog.js';
import { checkAuth } from '../../auth/utils.js';
import FetchFederatedGraphSchemaCommand from '../common/fetch-schema.js';
import ListFederatedGraphs from './commands/list.js';
import CheckFederatedGraphCommand from './commands/check.js';
import CreateFederatedGraphCommand from './commands/create.js';
import DeleteFederatedGraphCommand from './commands/delete.js';
import UpdateFederatedGraphCommand from './commands/update.js';
import MoveFederatedGraphCommand from './commands/move.js';
import FetchFederatedGraphCommand from './commands/fetch.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('federated-graph');
  command.description('Provides commands for creating and managing a federated graph');
  command.addCommand(CreateFederatedGraphCommand(opts));
  command.addCommand(DeleteFederatedGraphCommand(opts));
  command.addCommand(UpdateFederatedGraphCommand(opts));
  command.addCommand(CheckFederatedGraphCommand(opts));
  command.addCommand(ListFederatedGraphs(opts));
  command.addCommand(GetFederatedGraphChangelog(opts));
  command.addCommand(MoveFederatedGraphCommand(opts));
  command.addCommand(FetchFederatedGraphCommand(opts));
  command.addCommand(FetchFederatedGraphSchemaCommand(opts));

  command.hook('preAction', async () => {
    await checkAuth();
  });

  return command;
};
