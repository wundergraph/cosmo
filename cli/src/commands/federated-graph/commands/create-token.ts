import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const createTokenCommand = new Command('create-token');
  createTokenCommand.description(
    'Creates a new token for a federated graph. The token can be used to authenticate against the control plane from the routers.',
  );
  createTokenCommand.argument('<name>', 'The name of the federated graph that the token should be created for.');
  createTokenCommand.option(
    '-n, --name <name>',
    'The name of the token to create. Only serves as a reference for the user.',
  );
  createTokenCommand.option(
    '-r, --raw',
    'Prints the token in raw format. This is useful if you want to pipe the token into another command.',
  );
  createTokenCommand.action(async (name, options) => {
    const resp = await opts.client.platform.createFederatedGraphToken(
      {
        graphName: name,
        tokenName: options.name,
      },
      {
        headers: baseHeaders,
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      if (options.raw) {
        process.stdout.write(resp.token);
        return;
      }

      console.log(
        `${pc.green(`Successfully created token ${pc.bold(options.name)} for federated graph ${pc.bold(name)}`)}`,
      );
      console.log('');
      console.log(`${pc.bold(resp.token)}\n`);
      console.log(pc.yellow('---'));
      console.log(pc.yellow(`Please store the token in a secure place. It will not be shown again.`));
      console.log(pc.yellow(`You can use the token to authenticate against the control plane from the routers.`));
      console.log(pc.yellow('---'));
    } else {
      console.log(`${pc.red('Could not create token for federated graph')}`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return createTokenCommand;
};
