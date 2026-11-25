import Table from 'cli-table3';
import { Command, Option } from 'commander';
import logSymbols from 'log-symbols';
import pc from 'picocolors';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { stripProtobufInternals } from '../../../utils.js';
import { fetchAllProposals } from '../utils.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('list');
  command.description('Lists the proposals of a federated graph.');
  command.requiredOption(
    '-f, --federation-graph <federatedGraphName>',
    'The name of the federated graph to list proposals for.',
  );
  command.addOption(
    new Option(
      '-s, --status <statuses...>',
      'Only list proposals with these statuses. Draft proposals are awaiting approval.',
    ).choices(['draft', 'approved', 'published', 'closed']),
  );
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.', 'default');
  command.option('-j, --json', 'Prints to the console in json format instead of a table.');

  command.action(async (options) => {
    const result = await fetchAllProposals(opts.client, {
      federatedGraphName: options.federationGraph,
      namespace: options.namespace,
    });

    if (!result.success) {
      if (options.json) {
        console.log(
          JSON.stringify({
            status: 'error',
            code: result.code,
            message: 'Could not fetch proposals.',
            details: result.details,
          }),
        );
      } else {
        console.error(pc.red(result.details));
      }
      process.exitCode = 1;
      return;
    }

    const statuses: string[] | undefined = options.status?.map((status: string) => status.toUpperCase());
    const proposals = statuses ? result.proposals.filter((p) => statuses.includes(p.state)) : result.proposals;

    if (options.json) {
      const withoutSchemas = proposals.map(({ subgraphs, ...proposal }) => ({
        ...proposal,
        subgraphs: subgraphs.map(({ schemaSDL: _, ...subgraph }) => subgraph),
      }));
      console.log(JSON.stringify({ status: 'success', proposals: withoutSchemas }, stripProtobufInternals));
      return;
    }

    if (proposals.length === 0) {
      console.log('No proposals found');
      return;
    }

    const table = new Table({
      head: ['NAME', 'STATE', 'SUBGRAPHS', 'LATEST_CHECK', 'CREATED_BY', 'CREATED_AT'].map((h) => pc.bold(pc.white(h))),
      wordWrap: true,
      wrapOnWordBoundary: false,
    });

    for (const proposal of proposals) {
      table.push([
        proposal.name,
        proposal.state,
        proposal.subgraphs.map((subgraph) => subgraph.name).join(', '),
        proposal.latestCheckId ? (proposal.latestCheckSuccess ? logSymbols.success : logSymbols.error) : '-',
        proposal.createdByEmail || '-',
        proposal.createdAt,
      ]);
    }

    console.log(table.toString());
  });

  return command;
};
