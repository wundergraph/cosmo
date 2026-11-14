import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import { getBaseHeaders } from '../../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('show');
  command.description('Shows the audit log stream configuration and its delivery status.');
  command.option('--json', 'Prints the output as JSON.');
  command.action(async (options) => {
    const resp = await opts.client.platform.getAuditLogStreamConfig({}, { headers: getBaseHeaders() });

    if (resp.response?.code !== EnumStatusCode.OK) {
      program.error(pc.red(`Could not fetch the audit log stream. ${resp.response?.details ?? ''}`));
    }

    if (options.json) {
      console.log(JSON.stringify(resp.config ?? null, null, 2));
      return;
    }

    const config = resp.config;
    if (!config) {
      console.log('No audit log stream is configured.');
      return;
    }

    console.log(`Endpoint:    ${config.endpoint}`);
    console.log(`Token:       ****${config.tokenSuffix}`);
    console.log(`Index:       ${config.index ?? '(token default)'}`);
    console.log(`Source:      ${config.source}`);
    console.log(`Sourcetype:  ${config.sourcetype}`);
    console.log(`Enabled:     ${config.enabled ? pc.green('yes') : pc.yellow('no')}`);
    console.log(`Last sent:   ${config.lastSuccessAt ?? 'never'}`);
    if (config.lastError) {
      console.log(`Last error:  ${pc.red(`${config.lastErrorAt}: ${config.lastError}`)}`);
    }
  });

  return command;
};
