import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { BaseCommandOptions, WhoAmICommandJsonOutput } from '../../../core/types/types.js';
import { getBaseHeaders, config } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('whoami');
  command.description('Displays the users/service identity currently authenticated and in use.');
  command.option('-j, --json', 'Output the information in JSON format');

  command.action(async (options) => {
    const resp = await opts.client.platform.whoAmI(
      {},
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        if (options.json) {
          const successMessageJson: WhoAmICommandJsonOutput = {
            status: 'success',
            organizationName: resp.organizationName,
            organizationSlug: resp.organizationSlug,
            apiUrl: config.baseURL,
          };
          console.log(JSON.stringify(successMessageJson));
        } else {
          console.log('Organization:', pc.bold(resp.organizationName));
          console.log('Organization Slug:', pc.bold(resp.organizationSlug));
          console.log('Api Url:', config.baseURL);
        }
        break;
      }
      default: {
        if (options.json) {
          const errorJson: WhoAmICommandJsonOutput = {
            status: 'error',
            details: resp.response?.details || 'An unknown error occurred',
            organizationName: '',
            organizationSlug: '',
            apiUrl: '',
          };

          console.log(JSON.stringify(errorJson));
        } else if (resp.response?.details) {
          program.error(resp.response.details);
        } else {
          program.error('An unknown error occurred');
        }
      }
    }
  });

  return command;
};
