import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import pc from 'picocolors';
import ora from 'ora';
import { resolve } from 'pathe';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('update');
  command.description('Updates the tags of a contract.');
  command.argument('<name>', 'The name of the contract graph to update.');
  command.option('-n, --namespace [string]', 'The namespace of the contract update.');
  command.option(
    '-r, --routing-url <url>',
    'The routing url of your router. This is the url that the router will be accessible at.',
  );
  command.option('--exclude [tags...]', 'Schema elements with these tags will be excluded from the contract schema.');
  command.option('--include [tags...]', 'Schema elements with these tags will be included from the contract schema.');
  command.option('--suppress-warnings', 'This flag suppresses any warnings produced by composition.');
  command.option('--readme <path-to-readme>', 'The markdown file which describes the contract.');
  command.option(
    '--admission-webhook-url <url>',
    'The admission webhook url. This is the url that the controlplane will use to implement admission control for the federated graph.',
  );
  command.option(
    '--admission-webhook-secret [string]',
    'The admission webhook secret is used to sign requests to the webhook url.',
  );
  command.option(
    '--disable-resolvability-validation',
    'This flag will disable the validation for whether all nodes of the federated graph are resolvable. Do NOT use unless troubleshooting.',
  );

  command.action(async (name, options) => {
    if (options.exclude?.length > 0 && options.include?.length > 0) {
      program.error(
        pc.red(
          pc.bold(
            `The "exclude" and "include" options for tags are currently mutually exclusive.` +
              ` Both options have been provided, but one of the options must be empty or unset.`,
          ),
        ),
      );
    }

    let readmeFile;
    if (options.readme) {
      readmeFile = resolve(options.readme);
      if (!existsSync(readmeFile)) {
        program.error(
          pc.red(
            pc.bold(`The readme file '${pc.bold(readmeFile)}' does not exist. Please check the path and try again.`),
          ),
        );
      }
    }

    const spinner = ora('Contract is being updated...').start();
    const resp = await opts.client.platform.updateContract(
      {
        admissionWebhookSecret: options.admissionWebhookSecret,
        admissionWebhookUrl: options.admissionWebhookUrl,
        disableResolvabilityValidation: options.disableResolvabilityValidation,
        excludeTags: options.exclude,
        includeTags: options.include,
        name,
        namespace: options.namespace,
        readme: readmeFile ? await readFile(readmeFile, 'utf8') : undefined,
        routingUrl: options.routingUrl,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed('Contract was updated successfully.');
        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.fail('Contract updated but with composition errors.');

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

        for (const compositionError of resp.compositionErrors) {
          compositionErrorsTable.push([
            compositionError.federatedGraphName,
            compositionError.namespace,
            compositionError.featureFlag || '-',
            compositionError.message,
          ]);
        }
        console.log(compositionErrorsTable.toString());
        break;
      }
      case EnumStatusCode.ERR_DEPLOYMENT_FAILED: {
        spinner.warn(
          "The contract was updated, but the updated composition hasn't been deployed, so it's not accessible to the router. Check the errors listed below for details.",
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
        console.log(deploymentErrorsTable.toString());
        break;
      }
      default: {
        spinner.fail(`Failed to update contract.`);
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
