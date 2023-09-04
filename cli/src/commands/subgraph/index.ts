import { Command } from 'commander';
import { BaseCommandOptions } from '../../core/types/types.js';
import CheckSubgraph from './commands/check.js';
import CreateSubgraphCommand from './commands/create.js';
import PublishSubgraph from './commands/publish.js';
import DeleteSubgraph from './commands/delete.js';
import UpdateSubgraph from './commands/update.js';
import FixSubGraph from './commands/fix.js';
import ListSubgraphs from './commands/list.js';

export default (opts: BaseCommandOptions) => {
  const schema = new Command('subgraph');
  schema.description('Provides commands for creating and maintaining subgraphs of a federated graph');
  schema.addCommand(CreateSubgraphCommand(opts));
  schema.addCommand(PublishSubgraph(opts));
  schema.addCommand(CheckSubgraph(opts));
  schema.addCommand(DeleteSubgraph(opts));
  schema.addCommand(UpdateSubgraph(opts));
  schema.addCommand(FixSubGraph(opts));
  schema.addCommand(ListSubgraphs(opts));
  return schema;
};
