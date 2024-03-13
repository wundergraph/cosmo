import { Command } from 'commander';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { checkAPIKey } from '../../../utils.js';
import FetchMonographCommand from '../common/fetch.js';
import GetMonographChangelog from '../common/changelog.js';
import CreateMonographCommand from './commands/create.js';
import PublishMonographCommand from './commands/publish.js';
import UpdateMonographCommand from './commands/update.js';
import CheckMonographCommand from './commands/check.js';
import DeleteMonographCommand from './commands/delete.js';
import ListMonographs from './commands/list.js';
import MoveMonograph from './commands/move.js';
import MigrateMonograph from './commands/migrate.js';

export default (opts: BaseCommandOptions) => {
  const schema = new Command('monograph');
  schema.description('Provides commands for creating and managing a monograph');

  schema.addCommand(CreateMonographCommand(opts));
  schema.addCommand(FetchMonographCommand(opts));
  schema.addCommand(PublishMonographCommand(opts));
  schema.addCommand(UpdateMonographCommand(opts));
  schema.addCommand(CheckMonographCommand(opts));
  schema.addCommand(GetMonographChangelog(opts));
  schema.addCommand(DeleteMonographCommand(opts));
  schema.addCommand(ListMonographs(opts));
  schema.addCommand(MoveMonograph(opts));
  schema.addCommand(MigrateMonograph(opts));

  schema.hook('preAction', () => {
    checkAPIKey();
  });

  return schema;
};
