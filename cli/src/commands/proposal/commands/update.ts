import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Command, program } from 'commander';
import ora from 'ora';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export default (opts: BaseCommandOptions) => {
  const command = new Command('update');
  command.description('Updates an existing proposal for a federated graph.');
  command.argument('<id>', 'The ID of the proposal to update.');
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.');
  command.option(
    '--state <state>',
    'Set the state of the proposal. Valid values: "DRAFT", "OPEN", "APPROVED", "CLOSED".',
  );
  command.option(
    '--subgraph <subgraph>',
    'Specify a subgraph to update in the proposal. Format: <subgraph-name>:<path-to-schema>. Can be specified multiple times.',
    (value, previous) => {
      previous.push(value);
      return previous;
    },
    [],
  );
  command.option(
    '--deleted-subgraph <name>',
    'Specify a subgraph to be deleted in the proposal. Can be specified multiple times.',
    (value, previous) => {
      previous.push(value);
      return previous;
    },
    [],
  );

  command.action(async (id, options) => {
    if (!options.state && !options.subgraph.length && !options.deletedSubgraph.length) {
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
      const [subgraphName, schemaPath] = subgraphOption.split(':');

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

      try {
        const schemaContent = await readFile(resolvedSchemaPath, 'utf8');
        updatedSubgraphs.push({
          name: subgraphName,
          schemaSDL: schemaContent,
          isDeleted: false,
        });
      } catch (error) {
        program.error(pc.red(pc.bold(`Error reading schema file: ${error.message}`)));
      }
    }

    // Process subgraphs to delete
    for (const subgraphName of options.deletedSubgraph) {
      updatedSubgraphs.push({
        name: subgraphName,
        schemaSDL: '',
        isDeleted: true,
      });
    }

    const spinner = ora(`Updating proposal with ID: ${id}...`).start();

    try {
      const resp = await opts.client.platform.updateProposal(
        {
          proposalId: id,
          state: options.state,
          updatedSubgraphs,
          namespace: options.namespace,
        },
        {
          headers: getBaseHeaders(),
        },
      );

      if (resp.response?.code === EnumStatusCode.OK) {
        spinner.succeed(`Proposal with ID ${id} was updated successfully.`);
      } else {
        spinner.fail(`Failed to update proposal with ID ${id}.`);
        if (resp.response?.details) {
          console.log(pc.red(pc.bold(resp.response?.details)));
        }
        process.exitCode = 1;
      }
    } catch (error) {
      spinner.fail(`Failed to update proposal with ID ${id}.`);
      console.log(pc.red(pc.bold(error.message)));
      process.exitCode = 1;
    }
  });

  return command;
};
