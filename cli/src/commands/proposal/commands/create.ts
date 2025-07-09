import { Command, program } from 'commander';
import ora from 'ora';
import pc from 'picocolors';
import { ProposalNamingConvention } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { handleProposalResult } from '../../../handle-proposal-result.js';
import { processProposalSubgraphs } from '../utils.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('create');
  command.description('Creates a proposal for a federated graph.');
  command.argument('<name>', 'The name of the proposal to create.');
  command.requiredOption(
    '-f, --federation-graph <federatedGraphName>',
    'The name of the federated graph this proposal is for.',
  );
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.');
  command.option(
    '--subgraph <subgraph>',
    'Specify a subgraph to include in the proposal. Format: name:subgraph-name,schemaPath:path-to-schema. Can be specified multiple times.',
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
            'Please provide at least one subgraph to include or delete using --subgraph, --new-subgraph, or --deleted-subgraph options.',
          ),
        ),
      );
    }

    const subgraphs = await processProposalSubgraphs({
      subgraphs: options.subgraph,
      newSubgraphs: options.newSubgraph,
      deletedSubgraphs: options.deletedSubgraph,
    });

    const subgraphNames = subgraphs.map((subgraph) => subgraph.name);
    const uniqueSubgraphNames = new Set(subgraphNames);
    if (uniqueSubgraphNames.size !== subgraphNames.length) {
      program.error(
        pc.red(
          pc.bold('Subgraphs to be updated have to be unique. Please check the names of the subgraphs and try again.'),
        ),
      );
    }

    const spinner = ora('Creating proposal...').start();

    const resp = await opts.client.platform.createProposal(
      {
        federatedGraphName: options.federationGraph,
        namespace: options.namespace,
        name,
        subgraphs,
        namingConvention: ProposalNamingConvention.NORMAL,
      },
      {
        headers: getBaseHeaders(),
      },
    );

    spinner.stop();

    const result = handleProposalResult(resp, name, true);

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
