import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SubgraphType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { splitLabel } from '@wundergraph/cosmo-shared';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import { execa } from 'execa';
import ora from 'ora';
import path, { resolve } from 'pathe';
import pc from 'picocolors';
import { config, getBaseHeaders } from '../../../../../core/config.js';
import { BaseCommandOptions } from '../../../../../core/types/types.js';

function getDefaultPlatforms(): string[] {
  const supportedPlatforms = ['linux/amd64', 'linux/arm64', 'darwin/amd64', 'darwin/arm64', 'windows/amd64'];
  const defaultPlatforms = ['linux/amd64'];

  // Get current OS and architecture
  const currentPlatform = platform();
  const currentArch = arch();

  // Map Node.js platform/arch to Docker platform format
  let dockerPlatform: string | null = null;

  switch (currentPlatform) {
    case 'linux': {
      if (currentArch === 'x64') {
        dockerPlatform = 'linux/amd64';
      } else if (currentArch === 'arm64') {
        dockerPlatform = 'linux/arm64';
      }
      break;
    }
    case 'darwin': {
      if (currentArch === 'x64') {
        dockerPlatform = 'darwin/amd64';
      } else if (currentArch === 'arm64') {
        dockerPlatform = 'darwin/arm64';
      }
      break;
    }
    case 'win32': {
      if (currentArch === 'x64') {
        dockerPlatform = 'windows/amd64';
      }
      break;
    }
  }

  // Add user's platform to defaults if supported and not already included
  if (dockerPlatform && supportedPlatforms.includes(dockerPlatform) && !defaultPlatforms.includes(dockerPlatform)) {
    defaultPlatforms.push(dockerPlatform);
  }

  return defaultPlatforms;
}

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

    const schemaFile = resolve(pluginDir, 'src', 'schema.graphql');
    const dockerFile = resolve(pluginDir, 'Dockerfile');
    const protoSchemaFile = resolve(pluginDir, 'generated', 'service.proto');
    const protoMappingFile = resolve(pluginDir, 'generated', 'mapping.json');
    const protoLockFile = resolve(pluginDir, 'generated', 'service.proto.lock.json');

    if (!existsSync(schemaFile)) {
      program.error(
        pc.red(
          pc.bold(`The schema file '${pc.bold(schemaFile)}' does not exist. Please check the path and try again.`),
        ),
      );
    }

    const schemaBuffer = await readFile(schemaFile);
    const schema = new TextDecoder().decode(schemaBuffer);
    if (schema.trim().length === 0) {
      program.error(
        pc.red(pc.bold(`The schema file '${pc.bold(schemaFile)}' is empty. Please provide a valid schema.`)),
      );
    }

    if (!existsSync(dockerFile)) {
      program.error(
        pc.red(
          pc.bold(`The docker file '${pc.bold(dockerFile)}' does not exist. Please check the path and try again.`),
        ),
      );
    }

    if (!existsSync(protoSchemaFile)) {
      program.error(
        pc.red(
          pc.bold(
            `The proto schema file '${pc.bold(protoSchemaFile)}' does not exist. Please check the path and try again.`,
          ),
        ),
      );
    }
    const protoSchemaBuffer = await readFile(protoSchemaFile);
    const protoSchema = new TextDecoder().decode(protoSchemaBuffer);
    if (protoSchema.trim().length === 0) {
      program.error(
        pc.red(pc.bold(`The proto schema file '${pc.bold(protoSchemaFile)}' is empty. Please provide a valid schema.`)),
      );
    }

    if (!existsSync(protoMappingFile)) {
      program.error(
        pc.red(
          pc.bold(
            `The proto mapping file '${pc.bold(protoMappingFile)}' does not exist. Please check the path and try again.`,
          ),
        ),
      );
    }
    const protoMappingBuffer = await readFile(protoMappingFile);
    const protoMapping = new TextDecoder().decode(protoMappingBuffer);
    if (protoMapping.trim().length === 0) {
      program.error(
        pc.red(
          pc.bold(`The proto mapping file '${pc.bold(protoMappingFile)}' is empty. Please provide a valid mapping.`),
        ),
      );
    }

    if (!existsSync(protoLockFile)) {
      program.error(
        pc.red(
          pc.bold(
            `The proto lock file '${pc.bold(protoLockFile)}' does not exist. Please check the path and try again.`,
          ),
        ),
      );
    }
    const protoLockBuffer = await readFile(protoLockFile);
    const protoLock = new TextDecoder().decode(protoLockBuffer);
    if (protoLock.trim().length === 0) {
      program.error(
        pc.red(pc.bold(`The proto lock file '${pc.bold(protoLockFile)}' is empty. Please provide a valid lock.`)),
      );
    }

    // Validate platforms
    const supportedPlatforms = ['linux/amd64', 'linux/arm64', 'darwin/amd64', 'darwin/arm64', 'windows/amd64'];
    if (options.platform && options.platform.length > 0) {
      const invalidPlatforms = options.platform.filter((platform: string) => !supportedPlatforms.includes(platform));
      if (invalidPlatforms.length > 0) {
        program.error(
          pc.red(
            pc.bold(
              `Invalid platform(s): ${invalidPlatforms.join(', ')}. Supported platforms are: ${supportedPlatforms.join(', ')}`,
            ),
          ),
        );
      }
    }

    const spinner = ora('Plugin is being published...').start();

    const pluginDataResponse = await opts.client.platform.validateAndFetchPluginData(
      {
        name: pluginName,
        namespace: options.namespace,
        labels: options.label.map((label: string) => splitLabel(label)),
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (pluginDataResponse.response?.code !== EnumStatusCode.OK) {
      program.error(pc.red(pc.bold(pluginDataResponse.response?.details)));
    }

    const reference = pluginDataResponse.reference;
    const newVersion = pluginDataResponse.newVersion;
    const pushToken = pluginDataResponse.pushToken;

    // upload the docker image to the registry
    const platforms = options.platform && options.platform.join(',');
    const imageTag = `${config.pluginRegistryURL}/${reference}:${newVersion}`;

    try {
      // Docker login
      spinner.text = 'Logging into Cosmo registry...';
      await execa('docker', ['login', config.pluginRegistryURL, '-u', 'x', '--password-stdin'], {
        stdio: 'pipe',
        input: pushToken,
      });

      // Docker buildx build
      spinner.text = 'Building and pushing Docker image...';
      await execa(
        'docker',
        [
          'buildx',
          'build',
          '--sbom=false',
          '--provenance=false',
          '--push',
          '--platform',
          platforms,
          '-f',
          dockerFile,
          '-t',
          imageTag,
          pluginDir,
        ],
        {
          stdio: 'inherit',
        },
      );

      // Docker logout
      spinner.text = 'Logging out of Cosmo registry...';
      await execa('docker', ['logout', config.pluginRegistryURL], {
        stdio: 'pipe',
      });

      spinner.text = 'Subgraph is being published...';
    } catch (error) {
      spinner.fail(`Failed to build and push Docker image: ${error instanceof Error ? error.message : String(error)}`);
      program.error(
        pc.red(pc.bold(`Docker operation failed: ${error instanceof Error ? error.message : String(error)}`)),
      );
    }

    const resp = await opts.client.platform.publishFederatedSubgraph(
      {
        name: pluginName,
        namespace: options.namespace,
        schema,
        // Optional when subgraph does not exist yet
        labels: options.label.map((label: string) => splitLabel(label)),
        type: SubgraphType.GRPC_PLUGIN,
        proto: {
          schema: protoSchema,
          mappings: protoMapping,
          lock: protoLock,
          platforms: options.platform || [],
          version: newVersion,
        },
      },
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed(
          resp?.hasChanged === false
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
        if (resp.response?.details) {
          console.error(pc.red(pc.bold(resp.response?.details)));
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
