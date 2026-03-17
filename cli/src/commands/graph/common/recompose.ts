import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, program } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { CommonGraphCommandOptions } from '../../../core/types/types.js';
import { handleCompositionResult } from '../../../handle-composition-result.js';
import { limitMaxValue } from '../../../constants.js';

export default (opts: CommonGraphCommandOptions) => {
  const graphType = opts.isMonograph ? 'monograph' : 'federated graph';

  const command = new Command('recompose');
  command.description(`Triggers a recomposition of the specified ${graphType} using its current subgraphs.`);
  command.argument('<name>', `The name of the ${graphType} to recompose.`);
  command.option('-n, --namespace [string]', `The namespace of the ${graphType}.`);
  command.option('--suppress-warnings', 'This flag suppresses any warnings produced by composition.');
  command.option(
    '--disable-resolvability-validation',
    'This flag will disable the validation for whether all nodes of the federated graph are resolvable. Do NOT use unless troubleshooting.',
  );
  command.option(
    '--fail-on-composition-error',
    'If set, the command will fail if the composition of the federated graph fails.',
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

    const spinner = ora(`Recomposing ${graphType} "${name}"...`).start();

    const resp = await opts.client.platform.recomposeGraph(
      {
        disableResolvabilityValidation: options.disableResolvabilityValidation,
        isMonograph: opts.isMonograph ?? false,
        limit,
        name,
        namespace: options.namespace,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (!resp.response) {
      spinner.fail(`Failed to recompose ${graphType} "${pc.bold(name)}".`);
      process.exitCode = 1;
      return;
    }

    if (resp.response.code === EnumStatusCode.ERR_NOT_FOUND) {
      spinner.fail(`Failed to recompose ${graphType} "${pc.bold(name)}".`);
      let message =
        `${pc.red(`No valid record could be found for ${graphType} "${pc.bold(name)}".`)}\n` +
        `Please check the name and namespace for the ${graphType} in Cosmo Studio.`;
      if (resp.response.details) {
        message += `\n${pc.red(pc.bold(resp.response.details))}`;
      }
      program.error(message);
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
        successMessage: `${graphType.charAt(0).toUpperCase() + graphType.slice(1)} "${pc.bold(name)}" recomposed successfully.`,
        subgraphCompositionBaseErrorMessage: `Recomposition of ${graphType} "${pc.bold(name)}" failed.`,
        subgraphCompositionDetailedErrorMessage: `${pc.bold('Please check the errors below:')}`,
        deploymentErrorMessage:
          `${graphType.charAt(0).toUpperCase() + graphType.slice(1)} "${pc.bold(name)}" was recomposed but the updated composition could not be deployed.` +
          `\nThis means the updated composition is not accessible to the router.` +
          `\n${pc.bold('Please check the errors below:')}`,
        defaultErrorMessage: `Failed to recompose ${graphType} "${pc.bold(name)}".`,
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
