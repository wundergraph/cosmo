import { existsSync } from 'node:fs';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import ora from 'ora';
import path, { resolve } from 'pathe';
import pc from 'picocolors';
import {
  getDefaultPlatforms,
  publishPluginPipeline,
  readPluginFiles,
  SUPPORTED_PLATFORMS,
} from '../../../../../core/plugin-publish.js';
import { BaseCommandOptions } from '../../../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('publish');
  command.description(
    "Publishes a plugin subgraph on the control plane. If the plugin subgraph doesn't exists, it will be created.\nIf the publication leads to composition errors, the errors will be visible in the Studio.\nThe router will continue to work with the latest valid schema.\nConsider using the 'wgc subgraph check' command to check for composition errors before publishing.",
  );
  command.argument('[directory]', 'The path to the plugin directory.', '.');
  command.option('--name [string]', 'The name of the plugin.');
  command.option('-n, --namespace [string]', 'The namespace of the plugin subgraph.');
  command.option(
    '--platform [platforms...]',
    'The platforms used to build the image. Pass multiple platforms separated by spaces (e.g., --platform linux/amd64 linux/arm64). Supported formats: linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64. Defaults to linux/amd64 and includes your current platform if supported.',
    getDefaultPlatforms(),
  );
  command.option(
    '--label [labels...]',
    'The labels to apply to the plugin subgraph. The labels are passed in the format <key>=<value> <key>=<value>.' +
      ' This parameter is always ignored if the plugin subgraph has already been created.',
    [],
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
  command.option('--suppress-warnings', 'This flag suppresses any warnings produced by composition.');

  command.action(async (directory, options) => {
    const pluginDir = resolve(directory);
    if (!existsSync(pluginDir)) {
      program.error(
        pc.red(
          pc.bold(`The plugin directory '${pc.bold(pluginDir)}' does not exist. Please check the path and try again.`),
        ),
      );
    }

    const pluginName = options.name || path.basename(pluginDir);

    // Validate platforms
    if (options.platform && options.platform.length > 0) {
      const invalidPlatforms = options.platform.filter((platform: string) => !SUPPORTED_PLATFORMS.includes(platform));
      if (invalidPlatforms.length > 0) {
        program.error(
          pc.red(
            pc.bold(
              `Invalid platform(s): ${invalidPlatforms.join(', ')}. Supported platforms are: ${SUPPORTED_PLATFORMS.join(', ')}`,
            ),
          ),
        );
      }
    }

    // Read and validate plugin files
    let files;
    try {
      files = await readPluginFiles(pluginDir);
    } catch (error) {
      program.error(pc.red(pc.bold(error instanceof Error ? error.message : String(error))));
    }

    const spinner = ora('Plugin is being published...').start();

    const result = await publishPluginPipeline({
      client: opts.client,
      pluginName,
      pluginDir,
      namespace: options.namespace,
      labels: options.label,
      platforms: options.platform || [],
      files,
      onProcess: (proc) => {
        proc.stdout?.pipe(process.stdout);
        proc.stderr?.pipe(process.stderr);
      },
    });

    if (result.error && !result.response) {
      spinner.fail(result.error.message);
      program.error(pc.red(pc.bold(result.error.message)));
    }

    if (result.error) {
      spinner.fail(`Failed to publish plugin "${pluginName}".`);
      if (result.response?.details) {
        console.error(pc.red(pc.bold(result.response.details)));
      }
      process.exitCode = 1;
      return;
    }

    const resp = result.response!;

    switch (resp.code) {
      case EnumStatusCode.OK: {
        spinner.succeed(
          resp.hasChanged === false
            ? 'No new changes to publish.'
            : `Plugin ${pc.bold(pluginName)} published successfully.`,
        );
        console.log('');
        console.log(
          'To apply any new changes after this publication, update your plugin by modifying your schema (remember to generate), updating your implementation and then publishing again.',
        );
        if (resp.proposalMatchMessage) {
          console.log(pc.yellow(`Warning: Proposal match failed`));
          console.log(pc.yellow(resp.proposalMatchMessage));
        }
        break;
      }
      case EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL: {
        spinner.fail(`Failed to publish plugin "${pluginName}".`);
        console.log(pc.red(`Error: Proposal match failed`));
        console.log(pc.red(resp.proposalMatchMessage));
        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.warn('Plugin published but with composition errors.');
        if (resp.proposalMatchMessage) {
          console.log(pc.yellow(`Warning: Proposal match failed`));
          console.log(pc.yellow(resp.proposalMatchMessage));
        }

        const compositionErrorsTable = new Table({
          head: [
            pc.bold(pc.white('FEDERATED_GRAPH_NAME')),
            pc.bold(pc.white('NAMESPACE')),
            pc.bold(pc.white('FEATURE_FLAG')),
            pc.bold(pc.white('ERROR_MESSAGE')),
          ],
          colWidths: [30, 30, 30, 120],
          wordWrap: true,
        });

        console.log(
          pc.red(
            `We found composition errors, while composing the federated graph.\nThe router will continue to work with the latest valid schema.\n${pc.bold(
              'Please check the errors below:',
            )}`,
          ),
        );
        for (const compositionError of resp.compositionErrors) {
          compositionErrorsTable.push([
            compositionError.federatedGraphName,
            compositionError.namespace,
            compositionError.featureFlag || '-',
            compositionError.message,
          ]);
        }
        // Don't exit here with 1 because the change was still applied
        console.log(compositionErrorsTable.toString());

        if (options.failOnCompositionError) {
          program.error(pc.red(pc.bold('The command failed due to composition errors.')));
        }

        break;
      }
      case EnumStatusCode.ERR_DEPLOYMENT_FAILED: {
        spinner.warn(
          "Plugin was published, but the updated composition hasn't been deployed, so it's not accessible to the router. Check the errors listed below for details.",
        );

        const deploymentErrorsTable = new Table({
          head: [
            pc.bold(pc.white('FEDERATED_GRAPH_NAME')),
            pc.bold(pc.white('NAMESPACE')),
            pc.bold(pc.white('ERROR_MESSAGE')),
          ],
          colWidths: [30, 30, 120],
          wordWrap: true,
        });

        for (const deploymentError of resp.deploymentErrors) {
          deploymentErrorsTable.push([
            deploymentError.federatedGraphName,
            deploymentError.namespace,
            deploymentError.message,
          ]);
        }
        // Don't exit here with 1 because the change was still applied
        console.log(deploymentErrorsTable.toString());

        if (options.failOnAdmissionWebhookError) {
          program.error(pc.red(pc.bold('The command failed due to admission webhook errors.')));
        }

        break;
      }
      default: {
        spinner.fail(`Failed to publish plugin "${pluginName}".`);
        if (resp.details) {
          console.error(pc.red(pc.bold(resp.details)));
        }
        process.exitCode = 1;
        return;
      }
    }

    if (!options.suppressWarnings && resp.compositionWarnings.length > 0) {
      const compositionWarningsTable = new Table({
        head: [
          pc.bold(pc.white('FEDERATED_GRAPH_NAME')),
          pc.bold(pc.white('NAMESPACE')),
          pc.bold(pc.white('FEATURE_FLAG')),
          pc.bold(pc.white('WARNING_MESSAGE')),
        ],
        colWidths: [30, 30, 30, 120],
        wordWrap: true,
      });

      console.log(pc.yellow(`The following warnings were produced while composing the federated graph:`));
      for (const compositionWarning of resp.compositionWarnings) {
        compositionWarningsTable.push([
          compositionWarning.federatedGraphName,
          compositionWarning.namespace,
          compositionWarning.featureFlag || '-',
          compositionWarning.message,
        ]);
      }
      console.log(compositionWarningsTable.toString());
    }
  });

  return command;
};
