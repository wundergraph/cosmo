import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type { UpdateProposalResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

const proposalStatuses = ['APPROVED', 'CLOSED'] as const;
type ProposalStatus = (typeof proposalStatuses)[number];

const createJsonSuccessOutput = (proposalName: string, status: ProposalStatus) => ({
  status: 'success' as const,
  message: `Proposal '${proposalName}' status was updated to ${status} successfully.`,
});

const createJsonErrorOutput = (proposalName: string, code: EnumStatusCode, details?: string) => ({
  status: 'error' as const,
  code,
  message: `Failed to update status for proposal '${proposalName}'.`,
  details,
});

const parseProposalStatus = (value: string): ProposalStatus => {
  const status = value.toUpperCase();
  if (!proposalStatuses.includes(status as ProposalStatus)) {
    throw new InvalidArgumentError('Allowed values are approved and closed.');
  }
  return status as ProposalStatus;
};

const updateProposalStatus = async (
  client: BaseCommandOptions['client'],
  {
    proposalName,
    federatedGraphName,
    namespace,
    status,
  }: {
    proposalName: string;
    federatedGraphName: string;
    namespace: string;
    status: ProposalStatus;
  },
): Promise<
  | {
      status: 'success';
      response: UpdateProposalResponse;
    }
  | {
      status: 'error';
      error: Error;
    }
> => {
  try {
    const response = await client.platform.updateProposal(
      {
        proposalName,
        federatedGraphName,
        namespace,
        updateAction: {
          case: 'state',
          value: status,
        },
      },
      {
        headers: getBaseHeaders(),
      },
    );

    return {
      status: 'success',
      response,
    };
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error : new Error('An unknown error occurred.'),
    };
  }
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('update-status');
  command.description('Updates the status of an existing proposal for a federated graph.');
  command.argument('<name>', 'The name of the proposal to update.');
  command.requiredOption(
    '-f, --federation-graph <federatedGraphName>',
    'The name of the federated graph this proposal is for.',
  );
  command.requiredOption(
    '-s, --status <status>',
    'The status to set. Allowed values: approved, closed.',
    parseProposalStatus,
  );
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.', 'default');
  command.option('-j, --json', 'Prints to the console in json format instead of text');

  command.action(async (name, options) => {
    const responseMetadata = await updateProposalStatus(opts.client, {
      proposalName: name,
      federatedGraphName: options.federationGraph,
      namespace: options.namespace,
      status: options.status,
    });

    if (responseMetadata.status === 'error') {
      if (options.json) {
        console.log(JSON.stringify(createJsonErrorOutput(name, EnumStatusCode.ERR, responseMetadata.error.message)));
      } else {
        console.error(pc.red(responseMetadata.error.message));
      }

      process.exitCode = 1;
      return;
    }

    const resp = responseMetadata.response;

    if (resp.response?.code !== EnumStatusCode.OK) {
      if (options.json) {
        console.log(
          JSON.stringify(
            createJsonErrorOutput(name, resp.response?.code ?? EnumStatusCode.ERR, resp.response?.details),
          ),
        );
      } else {
        console.error(pc.red(resp.response?.details || `Failed to update status for proposal '${name}'.`));
      }
      process.exitCode = 1;
      return;
    }

    const output = createJsonSuccessOutput(name, options.status);
    console.log(options.json ? JSON.stringify(output) : pc.green(output.message));
  });

  return command;
};
