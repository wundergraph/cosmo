import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, program } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { handleCompositionResult } from '../../../handle-composition-result.js';
import { limitMaxValue } from '../../../constants.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('recompose');
  command.description('Triggers a recomposition of the specified feature flags using its current subgraphs.');
  command.argument('<name>', 'The name of the feature flag to recompose.');
  command.option('-n, --namespace [string]', 'The namespace of the feature flag.');
  command.option('--suppress-warnings', 'This flag suppresses any warning produced by composition.');
  command.option(
    '--disable-resolvability-validation',
    'This flag will disable the validation for whether all nodes of the feature flag are resolvable. Do NOT use unless troubleshooting.',
  );
  command.option(
    '--fail-on-composition-error',
    'If set, the command will fail if the composition of the feature flag fails.',
    false,
  );
  command.option(
    '--fail-on-admission-webhook-error',
    'If set, the command will fail if the admission webhook fails.',
    false,
  );
  command.option(
    '-l, --limit <number>',
    'The maximum number of composition errors, warnings, and deployment errors to display.',
    '50',
  );

  command.action(async (name, options) => {
    const limit = Number(options.limit);
    if (!Number.isInteger(limit) || limit <= 0 || limit > limitMaxValue) {
      program.error(
        pc.red(`The limit must be a valid number between 1 and ${limitMaxValue}. Received: '${options.limit}'`),
      );
    }

    const spinner = ora(`Recomposing feature flag "${name}"...`).start();
    const resp = await opts.client.platform.recomposeFeatureFlag(
      {
        disableResolvabilityValidation: options.disableResolvabilityValidation,
        limit,
        name,
        namespace: options.namespace,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (!resp.response) {
      spinner.fail(`Failed to recompose feature flag "${pc.bold(name)}".`);
      process.exitCode = 1;
      return;
    }

    switch (resp.response.code) {
      case EnumStatusCode.ERR: {
        spinner.fail(`Failed to recompose feature flag "${pc.bold(name)}".`);
        let message = `${pc.red('Split configuration loading is not enabled on the organization.')}`;

        if (resp.response.details) {
          message += `\n${pc.red(pc.bold(resp.response.details))}`;
        }

        program.error(message);
        break;
      }
      case EnumStatusCode.ERR_NOT_FOUND: {
        spinner.fail(`Failed to recompose feature flag "${pc.bold(name)}".`);
        let message =
          `${pc.red(`No valid record could be found for feature flag "${pc.bold(name)}".`)}\n` +
          `Please check the name and namespace for the feature flag in Cosmo Studio.`;

        if (resp.response.details) {
          message += `\n${pc.red(pc.bold(resp.response.details))}`;
        }

        program.error(message);
        break;
      }
    }

    try {
      handleCompositionResult({
        totalErrorCounts: resp.errorCounts,
        responseCode: resp.response.code,
        responseDetails: resp.response.details,
        compositionErrors: resp.compositionErrors,
        compositionWarnings: resp.compositionWarnings,
        deploymentErrors: resp.deploymentErrors,
        spinner,
        successMessage: `Feature flag "${pc.bold(name)}" recomposed successfully.`,
        subgraphCompositionBaseErrorMessage: `Recomposition of feature flag "${pc.bold(name)}" failed.`,
        subgraphCompositionDetailedErrorMessage: pc.bold('Please check the errors below:'),
        deploymentErrorMessage:
          `Feature flag was recomposed but the updated composition could not be deployed.` +
          `\nThis means the updated composition is not accessible to the router.` +
          `\n${pc.bold('Please check the errors below:')}`,
        defaultErrorMessage: `Failed to recompose feature flag "${pc.bold(name)}".`,
        suppressWarnings: options.suppressWarnings,
        failOnCompositionError: options.failOnCompositionError,
        failOnAdmissionWebhookError: options.failOnAdmissionWebhookError,
      });
    } catch {
      process.exitCode = 1;
    }
  });

  return command;
};
