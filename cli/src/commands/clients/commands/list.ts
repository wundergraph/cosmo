import { Command, program } from 'commander';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import Table from 'cli-table3';
import pc from 'picocolors';

import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

const createJsonSuccessOutput = (
  clients: Awaited<ReturnType<BaseCommandOptions['client']['platform']['getClients']>>['clients'],
) => ({
  status: 'success' as const,
  clients,
});

const createJsonErrorOutput = (code: EnumStatusCode, details?: string) => ({
  status: 'error' as const,
  code,
  message: 'Could not fetch clients.',
  details,
});

type JsonListClientsOutput = ReturnType<typeof createJsonSuccessOutput> | ReturnType<typeof createJsonErrorOutput>;

export default (opts: BaseCommandOptions) => {
  const command = new Command('list');
  command.description('Lists all registered GraphQL clients');
  command.option('-n, --namespace [string]', 'The namespace of the federated graph or monograph.', 'default');
  command.option('-j, --json', 'Prints to the console in json format instead of table');
  command.argument('<graph-name>', 'The name of the federated graph or monograph.');

  command.action(async (name, options) => {
    const resp = await opts.client.platform.getClients(
      {
        fedGraphName: name,
        namespace: options.namespace,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    if (resp.response?.code !== EnumStatusCode.OK) {
      if (options.json) {
        const output: JsonListClientsOutput = createJsonErrorOutput(
          resp.response?.code ?? EnumStatusCode.ERR,
          resp.response?.details,
        );
        console.log(JSON.stringify(output));
        process.exitCode = 1;
        return;
      }

      console.log(pc.red(resp.response?.details));
      program.error(pc.red('Could not fetch clients.'));
    }

    if (resp.clients.length === 0) {
      if (options.json) {
        const output: JsonListClientsOutput = createJsonSuccessOutput(resp.clients);
        console.log(JSON.stringify(output));
        return;
      }

      console.log('No clients found');
      return;
    }

    if (options.json) {
      const output: JsonListClientsOutput = createJsonSuccessOutput(resp.clients);
      console.log(JSON.stringify(output));
      return;
    }

    const clientsTable = new Table({
      head: [pc.bold(pc.white('NAME')), pc.bold(pc.white('CREATED_AT')), pc.bold(pc.white('LAST_PUSH'))],
      wordWrap: true,
      wrapOnWordBoundary: false,
    });

    for (const client of resp.clients) {
      clientsTable.push([client.name, client.createdAt, client.lastUpdatedAt || 'Never']);
    }

    console.log(clientsTable.toString());
  });
  return command;
};
