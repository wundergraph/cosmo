import { Command, program } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { handleProposalResult } from '../../../handle-proposal-result.js';
import { processProposalSubgraphs } from '../utils.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('update');
  command.description('Updates an existing proposal for a federated graph.');
  command.argument('<name>', 'The name of the proposal to update.');
  command.requiredOption(
    '-f, --federation-graph <federatedGraphName>',
    'The name of the federated graph this proposal is for.',
  );
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.');
  command.option(
    '--subgraph <subgraph>',
    'Specify a subgraph to update in the proposal. Format: name:subgraph-name,schemaPath:path-to-schema. Can be specified multiple times.',
    (value: string, previous: string[]) => {
      previous.push(value);
      return previous;
    },
    [],
  );
  command.option(
    '--new-subgraph <subgraph>',
    'Specify a new subgraph to add in the proposal. Format: name:subgraph-name,schemaPath:path-to-schema,labels:"key=value key=value". Can be specified multiple times.',
    (value: string, previous: string[]) => {
      previous.push(value);
      return previous;
    },
    [],
  );
  command.option(
    '--deleted-subgraph <name>',
    'Specify a subgraph to be deleted in the proposal. Can be specified multiple times.',
    (value: string, previous: string[]) => {
      previous.push(value);
      return previous;
    },
    [],
  );

  command.action(async (name, options) => {
    if (options.subgraph.length === 0 && options.deletedSubgraph.length === 0 && options.newSubgraph.length === 0) {
      program.error(
        pc.red(
          pc.bold(
            'Please provide at least one of: --subgraph, --new-subgraph, or --deleted-subgraph to update the proposal.',
          ),
        ),
      );
    }

    const updatedSubgraphs = await processProposalSubgraphs({
      subgraphs: options.subgraph,
      newSubgraphs: options.newSubgraph,
      deletedSubgraphs: options.deletedSubgraph,
    });

    const subgraphNames = updatedSubgraphs.map((subgraph) => subgraph.name);
    const uniqueSubgraphNames = new Set(subgraphNames);
    if (uniqueSubgraphNames.size !== subgraphNames.length) {
      program.error(
        pc.red(
          pc.bold('Subgraphs to be updated have to be unique. Please check the names of the subgraphs and try again.'),
        ),
      );
    }

    const spinner = ora(`Updating proposal: ${name}...`).start();

    const resp = await opts.client.platform.updateProposal(
      {
        proposalName: name,
        federatedGraphName: options.federationGraph,
        namespace: options.namespace,
        updateAction: {
          case: 'updatedSubgraphs',
          value: {
            subgraphs: updatedSubgraphs,
          },
        },
      },
      {
        headers: getBaseHeaders(),
      },
    );

    spinner.stop();

    const result = handleProposalResult(resp, name, false);

    if (result.success) {
      if (result.message) {
        console.log(result.message);
      }
    } else {
      if (result.message) {
        console.error(result.message);
      }
      process.exitCode = 1;
    }
  });

  return command;
};
