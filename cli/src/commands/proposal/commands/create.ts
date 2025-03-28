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
  const command = new Command('create');
  command.description('Creates a proposal for a federated graph.');
  command.argument('<name>', 'The name of the proposal to create.');
  command.option(
    '-f, --federation-graph <federatedGraphName>',
    'The name of the federated graph this proposal is for.',
  );
  command.option('-n, --namespace [string]', 'The namespace of the federated graph.');
  command.option(
    '--subgraph <subgraph>',
    'Specify a subgraph to include in the proposal. Format: <subgraph-name>:<path-to-schema>. Can be specified multiple times.',
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

  command.action(async (name, options) => {
    if (!options.federationGraph) {
      program.error(
        pc.red(pc.bold('Please provide a federated graph name using the -f or --federation-graph option.')),
      );
    }

    if (!options.subgraph.length && !options.deletedSubgraph.length) {
      program.error(
        pc.red(
          pc.bold(
            'Please provide at least one subgraph to include or delete using --subgraph or --deleted-subgraph options.',
          ),
        ),
      );
    }

    const subgraphs = [];

    // Process subgraphs to include in the proposal
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
        subgraphs.push({
          name: subgraphName,
          schemaSDL: schemaContent,
          isDeleted: false,
        });
      } catch (error) {
        program.error(pc.red(pc.bold(`Error reading schema file: ${error.message}`)));
      }
    }

    // Process subgraphs to delete in the proposal
    for (const subgraphName of options.deletedSubgraph) {
      subgraphs.push({
        name: subgraphName,
        schemaSDL: '',
        isDeleted: true,
      });
    }

    const spinner = ora('Creating proposal...').start();

    try {
      const resp = await opts.client.platform.createProposal(
        {
          federatedGraphName: options.federationGraph,
          namespace: options.namespace,
          name,
          subgraphs,
          didHubCreate: false,
        },
        {
          headers: getBaseHeaders(),
        },
      );

      if (resp.response?.code === EnumStatusCode.OK) {
        spinner.succeed(`Proposal '${name}' was created successfully with ID: ${resp.proposalId}`);
      } else {
        spinner.fail('Failed to create proposal.');
        if (resp.response?.details) {
          console.log(pc.red(pc.bold(resp.response?.details)));
        }
        process.exitCode = 1;
      }
    } catch (error) {
      spinner.fail('Failed to create proposal.');
      console.log(pc.red(pc.bold(error.message)));
      process.exitCode = 1;
    }
  });

  return command;
};
