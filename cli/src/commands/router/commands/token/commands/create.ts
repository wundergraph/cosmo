import { Command } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { BaseCommandOptions } from '../../../../../core/types/types.js';
import { getBaseHeaders } from '../../../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('create');
  command.description(
    'Creates a new token for a federated graph or monograph. The token can be used to authenticate against the control plane from the routers.',
  );
  command.argument('<name>', 'The name of the token to create. Only serves as a reference for the user.');
  command.requiredOption(
    '-g, --graph-name <graphName>',
    'The name of the federated graph or monograph that the token should be created for.',
  );
  command.option('-n, --namespace [string]', 'The namespace of the federated graph or monograph.');
  command.option(
    '-r, --raw',
    'Prints the token in raw format. This is useful if you want to pipe the token into another command.',
  );
  command.action(async (name, options) => {
    const resp = await opts.client.platform.createFederatedGraphToken(
      {
        tokenName: name,
        graphName: options.graphName,
        namespace: options.namespace,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      if (options.raw) {
        process.stdout.write(resp.token);
        return;
      }

      console.log(`${pc.green(`Successfully created token ${pc.bold(name)} for graph ${pc.bold(options.graphName)}`)}`);
      console.log('');
      console.log(`${pc.bold(resp.token)}\n`);
      console.log(pc.yellow('---'));
      console.log(pc.yellow(`Please store the token in a secure place. It will not be shown again.`));
      console.log(pc.yellow(`You can use the token only to authenticate against the Cosmo Platform from the routers.`));
      console.log(pc.yellow('---'));
    } else {
      console.log(`${pc.red('Could not create token for graph')}`);
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return command;
};
