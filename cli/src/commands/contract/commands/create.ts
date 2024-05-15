import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import { Command, program } from 'commander';
import { resolve } from 'pathe';
import pc from 'picocolors';
import ora from 'ora';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('create');
  command.description('Creates a contract graph from the provided source graph.');
  command.argument('<name>', 'The name of the contract graph to create.');
  command.option('-n, --namespace [string]', 'The namespace of the contract graph.');
  command.requiredOption('--source [string]', 'The source graph from which you want to create the contract.');
  command.requiredOption(
    '-r, --routing-url <url>',
    'The routing url of your router. This is the url that the router will be accessible at.',
  );
  command.option('--exclude [tags...]', 'Schema elements with these tags will be excluded from the contract schema.');
  command.option(
    '--admission-webhook-url <url>',
    'The admission webhook url. This is the url that the controlplane will use to implement admission control for the contract graph.',
    [],
  );
  command.option('--readme <path-to-readme>', 'The markdown file which describes the contract.');
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

    const spinner = ora('Contract is being created...').start();

    const resp = await opts.client.platform.createContract(
      {
        name,
        namespace: options.namespace,
        sourceGraphName: options.source,
        excludeTags: options.exclude,
        routingUrl: options.routingUrl,
        admissionWebhookUrl: options.admissionWebhookUrl,
        readme: readmeFile ? await readFile(readmeFile, 'utf8') : undefined,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    switch (resp.response?.code) {
      case EnumStatusCode.OK: {
        spinner.succeed('Contract graph was created successfully.');
        break;
      }
      case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED: {
        spinner.fail('Contract created but with composition errors.');

        const compositionErrorsTable = new Table({
          head: [
            pc.bold(pc.white('FEDERATED_GRAPH_NAME')),
            pc.bold(pc.white('NAMESPACE')),
            pc.bold(pc.white('ERROR_MESSAGE')),
          ],
          colWidths: [30, 30, 120],
          wordWrap: true,
        });

        for (const compositionError of resp.compositionErrors) {
          compositionErrorsTable.push([
            compositionError.federatedGraphName,
            compositionError.namespace,
            compositionError.message,
          ]);
        }
        console.log(compositionErrorsTable.toString());
        break;
      }
      case EnumStatusCode.ERR_DEPLOYMENT_FAILED: {
        spinner.warn(
          "The contract was created, but the composition hasn't been deployed, so it's not accessible to the router. Check the errors listed below for details.",
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
        spinner.fail(`Failed to create contract graph.`);
        if (resp.response?.details) {
          console.error(pc.red(pc.bold(resp.response?.details)));
        }
        process.exit(1);
      }
    }
  });

  return command;
};
