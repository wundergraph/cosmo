import { Command, program } from 'commander';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type {
  DeleteClientResponse,
  PreviewDeleteClientResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb.js';
import inquirer from 'inquirer';
import pc from 'picocolors';
import { config, getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

const createJsonSuccessOutput = (
  client: Awaited<DeleteClientResponse['client']>,
  deletedOperationsCount: number,
  persistedOperationsCount?: number,
  hasTraffic?: boolean,
) => ({
  status: 'success' as const,
  client: {
    ...client,
    persistedOperationsCount: persistedOperationsCount ?? 0,
    hasTraffic: hasTraffic ?? false,
  },
  deletedOperationsCount,
});

const createJsonErrorOutput = ({
  code,
  details,
  url,
  hasTraffic,
  operationsCount,
}: {
  code: EnumStatusCode;
  details?: string;
  url?: string;
  hasTraffic?: boolean;
  operationsCount?: number;
}) => ({
  status: 'error' as const,
  code,
  message: 'Could not delete client.',
  details,
  url,
  hasTraffic,
  operationsCount,
});

const createDeleteWarning = ({
  clientName,
  operationsCount,
  hasTraffic,
  url,
}: {
  clientName: string;
  operationsCount: number;
  hasTraffic: boolean;
  url: string;
}) => {
  const message = `Client '${clientName}' has ${operationsCount} persisted operation(s).`;

  if (hasTraffic) {
    return `${message} One or more operations have traffic. See details:\n${url}\n`;
  }

  return message;
};

const fetchPreviewDeleteClient = async (
  client: BaseCommandOptions['client'],
  {
    fedGraphName,
    namespace,
    clientName,
  }: {
    fedGraphName: string;
    namespace: string;
    clientName: string;
  },
): Promise<
  | {
      status: 'success';
      response: PreviewDeleteClientResponse;
    }
  | {
      status: 'error';
      error: Error;
    }
> => {
  try {
    const response = await client.platform.previewDeleteClient(
      {
        fedGraphName,
        namespace,
        clientName,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    return {
      status: 'success' as const,
      response,
    };
  } catch (err) {
    return {
      status: 'error' as const,
      error: err instanceof Error ? err : new Error('An unknown error occurred.'),
    };
  }
};

const deleteClient = async (
  client: BaseCommandOptions['client'],
  {
    fedGraphName,
    namespace,
    clientName,
  }: {
    fedGraphName: string;
    namespace: string;
    clientName: string;
  },
): Promise<
  | {
      status: 'success';
      response: DeleteClientResponse;
    }
  | {
      status: 'error';
      error: Error;
    }
> => {
  try {
    const response = await client.platform.deleteClient(
      {
        fedGraphName,
        namespace,
        clientName,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    return {
      status: 'success' as const,
      response,
    };
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err : new Error('An unknown error occurred.'),
    };
  }
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('delete');
  command.description('Deletes a registered GraphQL client');
  command.requiredOption(
    '-g, --graph-name <graphName>',
    'The name of the federated graph or monograph the client belongs to.',
  );
  command.option('-n, --namespace <string>', 'The namespace of the federated graph or monograph.', 'default');
  command.option('-j, --json', 'Prints to the console in json format instead of text');
  command.option(
    '-f, --force',
    'Deletes the client without confirmation. Required with --json if operations would be deleted or have traffic.',
  );
  command.argument('<client-name>', 'The name of the registered GraphQL client.');

  command.action(async (clientName, options) => {
    const previewResponseMetadata = await fetchPreviewDeleteClient(opts.client, {
      fedGraphName: options.graphName,
      namespace: options.namespace,
      clientName,
    });

    if (previewResponseMetadata.status === 'error') {
      if (options.json) {
        console.log(
          JSON.stringify(
            createJsonErrorOutput({
              code: EnumStatusCode.ERR,
              details: previewResponseMetadata.error.message,
            }),
          ),
        );
        process.exitCode = 1;
        return;
      }

      program.error(pc.red(previewResponseMetadata.error.message));
    }

    const previewResp = previewResponseMetadata.response;

    if (previewResp.response?.code !== EnumStatusCode.OK) {
      if (options.json) {
        const output = createJsonErrorOutput({
          code: previewResp.response?.code ?? EnumStatusCode.ERR,
          details: previewResp.response?.details,
        });
        console.log(JSON.stringify(output));
        process.exitCode = 1;
        return;
      }

      console.log(pc.red(previewResp.response?.details));
      program.error(pc.red('Could not delete client.'));
    }

    if ((previewResp.persistedOperationsCount > 0 || previewResp.hasTraffic) && !options.force) {
      const studioUrlObj = new URL(
        `${previewResp.organizationSlug}/${options.namespace}/graph/${options.graphName}/operations`,
        config.webURL,
      );
      studioUrlObj.searchParams.set('clientNames', previewResp.client?.name ?? '');
      const studioUrl = studioUrlObj.toString();
      const warning = createDeleteWarning({
        clientName,
        operationsCount: previewResp.persistedOperationsCount,
        hasTraffic: previewResp.hasTraffic,
        url: studioUrl,
      });

      if (options.json) {
        const output = createJsonErrorOutput({
          code: EnumStatusCode.ERR,
          details: warning,
          url: studioUrl,
          hasTraffic: previewResp.hasTraffic,
          operationsCount: previewResp.persistedOperationsCount,
        });
        console.log(JSON.stringify(output));
        process.exitCode = 1;
        return;
      }

      const deletionConfirmed = await inquirer.prompt({
        name: 'confirmDeletion',
        type: 'confirm',
        message: `${warning} Deleting it will also delete those operations. Continue?`,
      });

      if (!deletionConfirmed.confirmDeletion) {
        process.exitCode = 1;
        return;
      }
    }

    const deleteClientResponseMetadata = await deleteClient(opts.client, {
      fedGraphName: options.graphName,
      namespace: options.namespace,
      clientName,
    });

    if (deleteClientResponseMetadata.status === 'error') {
      if (options.json) {
        console.log(
          JSON.stringify(
            createJsonErrorOutput({
              code: EnumStatusCode.ERR,
              details: deleteClientResponseMetadata.error.message,
            }),
          ),
        );
        process.exitCode = 1;
        return;
      }
      program.error(pc.red(deleteClientResponseMetadata.error.message));
    }

    const resp = deleteClientResponseMetadata.response;

    if (resp.response?.code !== EnumStatusCode.OK) {
      if (options.json) {
        const output = createJsonErrorOutput({
          code: resp.response?.code ?? EnumStatusCode.ERR,
          details: resp.response?.details,
        });
        console.log(JSON.stringify(output));
        process.exitCode = 1;
        return;
      }

      console.log(pc.red(resp.response?.details));
      program.error(pc.red('Could not delete client.'));
    }

    if (options.json) {
      const output = createJsonSuccessOutput(
        resp.client,
        resp.deletedOperationsCount,
        previewResp.persistedOperationsCount,
        previewResp.hasTraffic,
      );
      console.log(JSON.stringify(output));
      return;
    }

    console.log(
      pc.dim(
        pc.green(
          `Client '${clientName}' was deleted. Deleted ${resp.deletedOperationsCount} related persisted operation(s).`,
        ),
      ),
    );
  });

  return command;
};
