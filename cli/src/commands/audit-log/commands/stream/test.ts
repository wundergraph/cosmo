import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import { getBaseHeaders } from '../../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('test');
  command.description('Sends a test event to the configured collector.');
  command.action(async () => {
    const resp = await opts.client.platform.testAuditLogStreamConfig({}, { headers: getBaseHeaders() });

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.green('Test event delivered.'));
    } else {
      program.error(pc.red(`Test event failed. ${resp.response?.details ?? ''}`));
    }
  });

  return command;
};
