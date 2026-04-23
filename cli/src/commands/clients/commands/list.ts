import { Command, program } from 'commander';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type { GetClientsResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb.js';
import Table from 'cli-table3';
import pc from 'picocolors';

import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

const createJsonSuccessOutput = (clients: Awaited<GetClientsResponse['clients']>) => ({
  status: 'success' as const,
  clients,
});

const createJsonErrorOutput = (code: EnumStatusCode, details?: string) => ({
  status: 'error' as const,
  code,
  message: 'Could not fetch clients.',
  details,
});

const fetchClients = async (
  client: BaseCommandOptions['client'],
  {
    fedGraphName,
    namespace,
  }: {
    fedGraphName: string;
    namespace: string;
  },
): Promise<
  | {
      response: GetClientsResponse;
      status: 'success';
    }
  | {
      error: Error;
      status: 'error';
    }
> => {
  try {
    const response = await client.platform.getClients(
      {
        fedGraphName,
        namespace,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    return {
      response,
      status: 'success' as const,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err : new Error('An unknown error occurred.'),
      status: 'error' as const,
    };
  }
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('list');
  command.description('Lists all registered GraphQL clients');
  command.option('-n, --namespace [string]', 'The namespace of the federated graph or monograph.', 'default');
  command.option('-j, --json', 'Prints to the console in json format instead of table');
  command.argument('<graph-name>', 'The name of the federated graph or monograph.');

  command.action(async (name, options) => {
    const fetchClientsResponseMetadata = await fetchClients(opts.client, {
      fedGraphName: name,
      namespace: options.namespace,
    });

    if (fetchClientsResponseMetadata.status === 'error') {
      if (options.json) {
        console.log(
          JSON.stringify(createJsonErrorOutput(EnumStatusCode.ERR, fetchClientsResponseMetadata.error.message)),
        );
        process.exitCode = 1;
        return;
      } else {
        program.error(pc.red(fetchClientsResponseMetadata.error.message));
      }
    }

    const resp = fetchClientsResponseMetadata.response;

    if (resp.response?.code !== EnumStatusCode.OK) {
      if (options.json) {
        const output = createJsonErrorOutput(resp.response?.code ?? EnumStatusCode.ERR, resp.response?.details);
        console.log(JSON.stringify(output));
        process.exitCode = 1;
        return;
      }

      console.log(pc.red(resp.response?.details));
      program.error(pc.red('Could not fetch clients.'));
    }

    if (resp.clients.length === 0) {
      if (options.json) {
        const output = createJsonSuccessOutput(resp.clients);
        console.log(JSON.stringify(output));
        return;
      }

      console.log('No clients found');
      return;
    }

    if (options.json) {
      const output = createJsonSuccessOutput(resp.clients);
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
