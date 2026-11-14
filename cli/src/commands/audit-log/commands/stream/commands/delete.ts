import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import { getBaseHeaders } from '../../../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('delete');
  command.description('Stops streaming audit logs and removes the configuration.');
  command.action(async () => {
    const resp = await opts.client.platform.deleteAuditLogStreamConfig({}, { headers: getBaseHeaders() });

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.green('Audit log stream removed.'));
    } else {
      program.error(pc.red(`Could not remove the audit log stream. ${resp.response?.details ?? ''}`));
    }
  });

  return command;
};
