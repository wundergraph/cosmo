import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, program } from 'commander';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../../core/config.js';
import { BaseCommandOptions } from '../../../../core/types/types.js';
import { verifyGitHubIntegration } from '../../../../github.js';
import { handleCheckResult } from '../../../../handle-check-result.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('check');
  command.description('Checks for breaking changes and errors.');
  command.argument('<name>', 'The name of the monograph on which the check operation is to be performed.');
  command.option('-n, --namespace [string]', 'The namespace of the monograph.');
  command.option('--schema <path-to-schema>', 'The path of the new schema file.');

  command.action(async (name, options) => {
    const schemaFile = resolve(process.cwd(), options.schema);

    if (!existsSync(schemaFile)) {
      console.log(
        pc.red(
          pc.bold(`The schema file '${pc.bold(schemaFile)}' does not exist. Please check the path and try again.`),
        ),
      );
      return;
    }

    const { gitInfo, ignoreErrorsDueToGitHubIntegration } = await verifyGitHubIntegration(opts.client);

    const graphResp = await opts.client.platform.getFederatedGraphByName(
      {
        name,
        namespace: options.namespace,
        includeMetrics: false,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (graphResp.response?.code !== EnumStatusCode.OK) {
      program.error(pc.red(`Could not perform check. ${graphResp.response?.details}`));
    }

    if (graphResp.subgraphs.length === 0) {
      program.error(pc.red(`Could not perform check. No subgraph found.`));
    }

    const subgraph = graphResp.subgraphs[0];

    const resp = await opts.client.platform.checkSubgraphSchema(
      {
        subgraphName: subgraph.name,
        namespace: subgraph.namespace,
        schema: await readFile(schemaFile),
        gitInfo,
        delete: false,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    const success = handleCheckResult(resp);

    if (!success && !ignoreErrorsDueToGitHubIntegration) {
      process.exit(1);
    }
  });

  return command;
};
