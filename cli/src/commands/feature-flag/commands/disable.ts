import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('disable');
  command.description('Disables a feature flag on the control plane.');
  command.argument('<name>', 'The name of the feature flag to disable.');
  command.option('-n, --namespace [string]', 'The namespace of the feature flag.');

  command.action(async (name, options) => {
    const spinner = ora('Feature flag is being disabled...').start();
    const resp = await opts.client.platform.enableFeatureFlag(
      {
        featureFlagName: name,
        namespace: options.namespace,
        enabled: false,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      spinner.succeed('Feature flag was disabled successfully.');
    } else {
      spinner.fail('Failed to disable feature flag.');
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return command;
};
