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
  const command = new Command('monograph');
  command.description('Provides commands for creating and managing a monograph');

  command.addCommand(CreateMonographCommand(opts));
  command.addCommand(FetchMonographCommand(opts));
  command.addCommand(PublishMonographCommand(opts));
  command.addCommand(UpdateMonographCommand(opts));
  command.addCommand(CheckMonographCommand(opts));
  command.addCommand(GetMonographChangelog(opts));
  command.addCommand(DeleteMonographCommand(opts));
  command.addCommand(ListMonographs(opts));
  command.addCommand(MoveMonograph(opts));
  command.addCommand(MigrateMonograph(opts));

  command.hook('preAction', () => {
    checkAPIKey();
  });

  return command;
};
