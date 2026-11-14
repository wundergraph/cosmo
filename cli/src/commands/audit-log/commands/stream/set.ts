import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import { getBaseHeaders } from '../../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('set');
  command.description(
    'Creates or replaces the audit log stream. Options that are left out are reset to their defaults, except the token, which is kept.',
  );
  command.requiredOption('--endpoint <url>', 'The HEC URL, e.g. https://splunk.example.com:8088');
  command.option(
    '--token <token>',
    'The HEC token. Required the first time. Can also be set with the COSMO_HEC_TOKEN environment variable.',
  );
  command.option('--index <index>', "The Splunk index. Defaults to the token's default index.");
  command.option('--source <source>', 'The Splunk source. Defaults to "cosmo".');
  command.option('--sourcetype <sourcetype>', 'The Splunk sourcetype. Defaults to "wundergraph:cosmo:audit".');
  command.option('--disabled', 'Saves the configuration without streaming.');
  command.action(async (options) => {
    const resp = await opts.client.platform.upsertAuditLogStreamConfig(
      {
        endpoint: options.endpoint,
        token: options.token ?? process.env.COSMO_HEC_TOKEN,
        index: options.index,
        source: options.source,
        sourcetype: options.sourcetype,
        enabled: !options.disabled,
      },
      { headers: getBaseHeaders() },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      console.log(pc.green('Audit log stream saved.'));
    } else {
      program.error(pc.red(`Could not save the audit log stream. ${resp.response?.details ?? ''}`));
    }
  });

  return command;
};
