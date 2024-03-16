import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import pc from 'picocolors';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { resolve } from 'pathe';
import ora from 'ora';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders } from '../../../core/config.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('update');
  command.description('Updates a federated graph on the control plane.');
  command.argument('<name>', 'The name of the federated graph to update.');
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.');
  command.option(
    '-r, --routing-url <url>',
    'The routing url of your router. This is the url that the router will be accessible at.',
  );
  command.option(
    '--label-matcher [labels...]',
    'The label matcher is used to select the subgraphs to federate. The labels are passed in the format <key>=<value> <key>=<value>. They are separated by spaces and grouped using comma. Example: --label-matcher team=A,team=B env=prod',
  );
  command.option(
    '--admission-webhook-url <url>',
    'The admission webhook url. This is the url that the controlplane will use to implement admission control for the federated graph.',
    [],
  );
  command.option(
    '--unset-label-matchers',
    'This will remove all label matchers. It will not add new label matchers if both this and --label-matchers option is passed.',
  );
  command.option(
    '--unset-admission-webhook-url',
    'This will remove the admission webhook url. It will not add new admission webhook url if both this and --admission-webhook-url option is passed.',
  );
  command.option('--readme <path-to-readme>', 'The markdown file which describes the subgraph.');
  command.action(async (name, options) => {
    let readmeFile;
    if (options.readme) {
      readmeFile = resolve(process.cwd(), options.readme);
      if (!existsSync(readmeFile)) {
        program.error(
          pc.red(
            pc.bold(`The readme file '${pc.bold(readmeFile)}' does not exist. Please check the path and try again.`),
          ),
        );
      }
    }

    const spinner = ora('Federated Graph is being updated...').start();
    const resp = await opts.client.platform.updateFederatedGraph(
      {
        name,
        namespace: options.namespace,
        routingUrl: options.routingUrl,
        labelMatchers: options.labelMatcher,
        admissionWebhookURL: options.admissionWebhookUrl,
        unsetLabelMatchers: options.unsetLabelMatchers,
        unsetAdmissionWebhookUrl: options.unsetAdmissionWebhookUrl,
        readme: readmeFile ? await readFile(readmeFile, 'utf8') : undefined,
      },
      {
        headers: baseHeaders,
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed(`Federated Graph was updated successfully.`);

        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.warn(`Federated Graph was updated but with composition errors.`);

        const compositionErrorsTable = new Table({
          head: [
            pc.bold(pc.white('FEDERATED_GRAPH_NAME')),
            pc.bold(pc.white('NAMESPACE')),
            pc.bold(pc.white('ERROR_MESSAGE')),
          ],
          colWidths: [30, 30, 120],
          wordWrap: true,
        });

        console.log(
          pc.yellow(
            'But we found composition errors, while composing the federated graph.\nThe graph will not be updated until the errors are fixed. Please check the errors below:',
          ),
        );
        for (const compositionError of resp.compositionErrors) {
          compositionErrorsTable.push([
            compositionError.federatedGraphName,
            compositionError.namespace,
            compositionError.message,
          ]);
        }
        // Don't exit here with 1 because the change was still applied
        console.log(compositionErrorsTable.toString());

        break;
      }
      case EnumStatusCode.ERR_DEPLOYMENT_FAILED: {
        spinner.warn(
          "The Federated Graph was updated, but the updated composition hasn't been deployed, so it's not accessible to the router. Check the errors listed below for details.",
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

        break;
      }
      default: {
        spinner.fail(`Failed to update federated graph.`);
        if (resp.response?.details) {
          console.log(pc.red(pc.bold(resp.response?.details)));
        }
        process.exit(1);
      }
    }
  });

  return command;
};
