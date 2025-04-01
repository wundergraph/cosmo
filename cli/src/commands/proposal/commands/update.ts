import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, program } from 'commander';
import ora from 'ora';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';
import { handleProposalResult } from '../../../handle-proposal-result.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('update');
  command.description('Updates an existing proposal for a federated graph.');
  command.argument('<name>', 'The name of the proposal to update.');
  command.option(
    '-f, --federation-graph <federatedGraphName>',
    'The name of the federated graph this proposal is for.',
  );
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.');
  command.option(
    '--state <state>',
    'Set the state of the proposal. Valid values: "DRAFT", "OPEN", "APPROVED", "CLOSED".',
  );
  command.option(
    '--subgraph <subgraph>',
    'Specify a subgraph to update in the proposal. Format: <subgraph-name>=<path-to-schema>. Can be specified multiple times.',
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
    if (!options.federationGraph) {
      program.error(
        pc.red(pc.bold('Please provide a federated graph name using the -f or --federation-graph option.')),
      );
    }

    if (!options.state && options.subgraph.length === 0 && options.deletedSubgraph.length === 0) {
      program.error(
        pc.red(
          pc.bold('Please provide at least one of: --state, --subgraph, or --deleted-subgraph to update the proposal.'),
        ),
      );
    }

    // Validate state if provided
    if (options.state) {
      const validStates = ['DRAFT', 'OPEN', 'APPROVED', 'CLOSED'];
      if (!validStates.includes(options.state)) {
        program.error(pc.red(pc.bold(`Invalid state: ${options.state}. Valid states are: ${validStates.join(', ')}.`)));
      }
    }

    const updatedSubgraphs = [];

    // Process subgraphs to update
    for (const subgraphOption of options.subgraph) {
      const [subgraphName, schemaPath] = subgraphOption.split('=');

      if (!subgraphName || !schemaPath) {
        program.error(
          pc.red(
            pc.bold(`Invalid subgraph format: ${subgraphOption}. Expected format is <subgraph-name>:<path-to-schema>.`),
          ),
        );
      }

      const resolvedSchemaPath = resolve(schemaPath);
      if (!existsSync(resolvedSchemaPath)) {
        program.error(
          pc.red(
            pc.bold(
              `The schema file '${pc.bold(resolvedSchemaPath)}' does not exist. Please check the path and try again.`,
            ),
          ),
        );
      }

      const schemaBuffer = await readFile(resolvedSchemaPath);
      const schema = new TextDecoder().decode(schemaBuffer);
      if (schema.trim().length === 0) {
        program.error(
          pc.red(pc.bold(`The schema file '${pc.bold(resolvedSchemaPath)}' is empty. Please provide a valid schema.`)),
        );
      }
      updatedSubgraphs.push({
        name: subgraphName,
        schemaSDL: schema,
        isDeleted: false,
      });
    }

    // Process subgraphs to delete
    for (const subgraphName of options.deletedSubgraph) {
      updatedSubgraphs.push({
        name: subgraphName,
        schemaSDL: '',
        isDeleted: true,
      });
    }

    const spinner = ora(`Updating proposal: ${name}...`).start();

    let resp;
    try {
      resp = await opts.client.platform.updateProposal(
        {
          proposalName: name,
          federatedGraphName: options.federationGraph,
          namespace: options.namespace,
          ...(options.state ? { state: options.state } : {}),
          ...(updatedSubgraphs.length > 0 ? { updatedSubgraphs: { subgraphs: updatedSubgraphs } } : {}),
        },
        {
          headers: getBaseHeaders(),
        },
      );
    } catch (error: unknown) {
      resp = error instanceof Error ? error : new Error(String(error));
    }

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
