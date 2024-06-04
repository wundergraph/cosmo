import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { splitLabel } from '@wundergraph/cosmo-shared';
import { Command, program } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('create');
  command.description('Creates a feature flag group on the control plane.');
  command.argument('<name>', 'The name of the feature flag group to create.');
  command.option('-n, --namespace [string]', 'The namespace of the feature flag.');
  command.option(
    '--label [labels...]',
    'The labels to apply to the feature flag. The labels are passed in the format <key>=<value> <key>=<value>.',
  );
  command.requiredOption(
    '-ff, --feature-flags <featureFlags...>',
    'The names of the feature flags which have to be the part of the group. The feature flags are passed in the format <featureFlag1> <featureFlag2> <featureFlag3>. The feature flag group must have at least 2 feature flags.',
  );
  command.action(async (name, options) => {
    if (!options.featureFlags || options.featureFlags.length < 2) {
      program.error(
        pc.red(
          pc.bold(
            `The feature flag group must have at least 2 feature flags. Please check the feature flags and try again.`,
          ),
        ),
      );
    }

    const spinner = ora('Feature flag group is being created...').start();
    const resp = await opts.client.platform.createFeatureFlagGroup(
      {
        featureFlagGroupName: name,
        namespace: options.namespace,
        labels: options.label ? options.label.map((label: string) => splitLabel(label)) : [],
        featureFlagNames: options.featureFlags,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code === EnumStatusCode.OK) {
      spinner.succeed('Feature flag group was created successfully.');
    } else {
      spinner.fail('Failed to create feature flag group.');
      if (resp.response?.details) {
        console.log(pc.red(pc.bold(resp.response?.details)));
      }
      process.exit(1);
    }
  });

  return command;
};
