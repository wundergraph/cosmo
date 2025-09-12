import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SubgraphType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { splitLabel } from '@wundergraph/cosmo-shared';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import ora from 'ora';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('publish');
  command.description(
    "Publishes a gRPC subgraph on the control plane. If the gRPC subgraph doesn't exist, it will be created.\nIf the publication leads to composition errors, the errors will be visible in the Studio.\nThe router will continue to work with the latest valid schema.\nConsider using the 'wgc subgraph check' command to check for composition errors before publishing.",
  );
  command.argument('<name>', 'The name of the gRPC subgraph.');
  command.requiredOption('--schema <path-to-schema>', 'The schema file to upload to the subgraph.');
  command.requiredOption(
    '--generated <path-to-generated-folder>',
    'The path to the generated folder which contains the proto schema, mapping and lock files.',
  );
  command.option('-n, --namespace [string]', 'The namespace of the gRPC subgraph.');
  command.option(
    '-r, --routing-url <url>',
    'The routing URL of the gRPC subgraph. This is the URL at which the gRPC subgraph will be accessible.' +
      ' This parameter is always ignored if the subgraph has already been created.',
  );
  command.option(
    '--label [labels...]',
    'The labels to apply to the gRPC subgraph. The labels are passed in the format <key>=<value> <key>=<value>.' +
      ' This parameter is always ignored if the gRPC subgraph has already been created.',
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

  command.action(async (name, options) => {
    const schemaFile = resolve(options.schema);
    if (!existsSync(schemaFile)) {
      program.error(
        pc.red(pc.bold(`The schema file '${schemaFile}' does not exist. Please check the path and try again.`)),
      );
    }

    const schemaBuffer = await readFile(schemaFile);
    const schema = new TextDecoder().decode(schemaBuffer);
    if (schema.trim().length === 0) {
      program.error(pc.red(pc.bold(`The schema file '${schemaFile}' is empty. Please provide a valid schema.`)));
    }

    const grpcSubgraphGeneratedDir = resolve(options.generated);
    if (!existsSync(grpcSubgraphGeneratedDir)) {
      program.error(
        pc.red(
          pc.bold(
            `The gRPC subgraph generated directory '${grpcSubgraphGeneratedDir}' does not exist. Please check the path and try again.`,
          ),
        ),
      );
    }

    const protoSchemaFile = resolve(grpcSubgraphGeneratedDir, 'service.proto');
    const protoMappingFile = resolve(grpcSubgraphGeneratedDir, 'mapping.json');
    const protoLockFile = resolve(grpcSubgraphGeneratedDir, 'service.proto.lock.json');

    if (!existsSync(protoSchemaFile)) {
      program.error(
        pc.red(
          pc.bold(`The proto schema file '${protoSchemaFile}' does not exist. Please check the path and try again.`),
        ),
      );
    }
    const protoSchemaBuffer = await readFile(protoSchemaFile);
    const protoSchema = new TextDecoder().decode(protoSchemaBuffer);
    if (protoSchema.trim().length === 0) {
      program.error(
        pc.red(pc.bold(`The proto schema file '${protoSchemaFile}' is empty. Please provide a valid schema.`)),
      );
    }

    if (!existsSync(protoMappingFile)) {
      program.error(
        pc.red(
          pc.bold(`The proto mapping file '${protoMappingFile}' does not exist. Please check the path and try again.`),
        ),
      );
    }
    const protoMappingBuffer = await readFile(protoMappingFile);
    const protoMapping = new TextDecoder().decode(protoMappingBuffer);
    if (protoMapping.trim().length === 0) {
      program.error(
        pc.red(pc.bold(`The proto mapping file '${protoMappingFile}' is empty. Please provide a valid mapping.`)),
      );
    }

    if (!existsSync(protoLockFile)) {
      program.error(
        pc.red(pc.bold(`The proto lock file '${protoLockFile}' does not exist. Please check the path and try again.`)),
      );
    }
    const protoLockBuffer = await readFile(protoLockFile);
    const protoLock = new TextDecoder().decode(protoLockBuffer);
    if (protoLock.trim().length === 0) {
      program.error(pc.red(pc.bold(`The proto lock file '${protoLockFile}' is empty. Please provide a valid lock.`)));
    }

    const spinner = ora('GRPC Subgraph is being published...').start();

    const resp = await opts.client.platform.publishFederatedSubgraph(
      {
        name,
        namespace: options.namespace,
        schema,
        // Optional when subgraph does not exist yet
        routingUrl: options.routingUrl,
        labels: options.label.map((label: string) => splitLabel(label)),
        type: SubgraphType.GRPC_SERVICE,
        proto: {
          schema: protoSchema,
          mappings: protoMapping,
          lock: protoLock,
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
            : `The gRPC subgraph ${pc.bold(name)} published successfully.`,
        );
        console.log('');
        console.log(
          'To apply any new changes after this publication, update your gRPC subgraph by modifying your schema (remember to generate), updating your implementation and then publishing again.',
        );
        if (resp.proposalMatchMessage) {
          console.log(pc.yellow(`Warning: Proposal match failed`));
          console.log(pc.yellow(resp.proposalMatchMessage));
        }
        break;
      }
      case EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL: {
        spinner.fail(`Failed to publish gRPC subgraph "${name}".`);
        console.log(pc.red(`Error: Proposal match failed`));
        console.log(pc.red(resp.proposalMatchMessage));
        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.warn('The gRPC subgraph was published but with composition errors.');
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
          "The gRPC subgraph was published, but the updated composition hasn't been deployed, so it's not accessible to the router. Check the errors listed below for details.",
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
        spinner.fail(`Failed to publish gRPC subgraph "${name}".`);
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
