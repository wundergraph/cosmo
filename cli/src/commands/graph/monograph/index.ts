import { Command } from 'commander';
import { BaseCommandOptions } from '../../../core/types/types.js';
import FetchMonographCommand from '../common/fetch.js';
import GetMonographChangelog from '../common/changelog.js';
import { checkAuth } from '../../auth/utils.js';
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
  command.addCommand(PublishMonographCommand(opts));
  command.addCommand(UpdateMonographCommand(opts));
  command.addCommand(CheckMonographCommand(opts));
  command.addCommand(DeleteMonographCommand(opts));
  command.addCommand(ListMonographs(opts));
  command.addCommand(MoveMonograph(opts));
  command.addCommand(MigrateMonograph(opts));

  command.addCommand(FetchMonographCommand({ ...opts, isMonograph: true }));
  command.addCommand(GetMonographChangelog({ ...opts, isMonograph: true }));

  command.hook('preAction', async () => {
    await checkAuth();
  });

  return command;
};
