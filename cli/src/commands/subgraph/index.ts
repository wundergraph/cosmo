import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import { checkAPIKey } from '../../utils.js';
import CheckSubgraph from './commands/check.js';
import CreateSubgraphCommand from './commands/create.js';
import PublishSubgraph from './commands/publish.js';
import DeleteSubgraph from './commands/delete.js';
import UpdateSubgraph from './commands/update.js';
import FixSubGraph from './commands/fix.js';
import ListSubgraphs from './commands/list.js';
import IntrospectSubgraph from './commands/introspect.js';
import MoveSubgraph from './commands/move.js';
import FetchSubgraph from './commands/fetch.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('subgraph');
  command.description('Provides commands for creating and maintaining subgraphs of a federated graph');
  command.addCommand(CreateSubgraphCommand(opts));
  command.addCommand(PublishSubgraph(opts));
  command.addCommand(CheckSubgraph(opts));
  command.addCommand(DeleteSubgraph(opts));
  command.addCommand(UpdateSubgraph(opts));
  command.addCommand(FixSubGraph(opts));
  command.addCommand(ListSubgraphs(opts));
  command.addCommand(IntrospectSubgraph(opts));
  command.addCommand(MoveSubgraph(opts));
  command.addCommand(FetchSubgraph(opts));

  command.hook('preAction', () => {
    checkAPIKey();
  });

  return command;
};
