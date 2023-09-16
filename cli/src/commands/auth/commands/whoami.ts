import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders, config } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const schemaPush = new Command('whoami');
  schemaPush.description('Displays the users/service identity currently authenticated and in use.');

  schemaPush.action(async (name, options) => {
    const resp = await opts.client.platform.whoAmI(
      {},
      {
        headers: baseHeaders,
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        console.log('Organization:', pc.bold(resp.organizationName));
        console.log('Api Url:', config.baseURL);
        break;
      }
      default: {
        if (resp.response?.details) {
          program.error(resp.response.details);
        } else {
          program.error('An unknown error occurred');
        }
      }
    }
  });

  return schemaPush;
};
