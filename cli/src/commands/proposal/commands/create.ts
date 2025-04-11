import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Label } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb.js';
import { splitLabel } from '@wundergraph/cosmo-shared';
import { Command, program } from 'commander';
import ora from 'ora';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { getBaseHeaders } from '../../../core/config.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { handleProposalResult } from '../../../handle-proposal-result.js';

// Define interfaces for parsing parameters
interface SubgraphParams {
  name: string;
  schemaPath: string;
  [key: string]: string;
}

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

    const subgraphs = [];

    // Process subgraphs to include in the proposal
    for (const subgraphOption of options.subgraph) {
      const parts = subgraphOption.split(',');
      const params: SubgraphParams = { name: '', schemaPath: '' };

      for (const part of parts) {
        const [key, value] = part.split(':');
        if (key && value) {
          params[key] = value;
        }
      }

      if (!params.name || !params.schemaPath) {
        program.error(
          pc.red(
            pc.bold(
              `Invalid subgraph format: ${subgraphOption}. Expected format is name:subgraph-name,schemaPath:path-to-schema.`,
            ),
          ),
        );
      }

      const resolvedSchemaPath = resolve(params.schemaPath);
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
      subgraphs.push({
        name: params.name,
        schemaSDL: schema,
        isDeleted: false,
        isNew: false,
        labels: [],
      });
    }

    // Process new subgraphs with labels
    for (const subgraphOption of options.newSubgraph || []) {
      const parts = subgraphOption.split(',');
      const params: SubgraphParams = { name: '', schemaPath: '' };
      let labels: Label[] = [];

      for (const part of parts) {
        if (part.startsWith('labels:')) {
          const labelsStr = part.slice('labels:'.length);
          const labelStrings = labelsStr.trim().split(' ');
          labels = labelStrings.map((label: string) => splitLabel(label));
        } else {
          const [key, value] = part.split(':');
          if (key && value) {
            params[key] = value;
          }
        }
      }

      if (!params.name || !params.schemaPath) {
        program.error(
          pc.red(
            pc.bold(
              `Invalid new-subgraph format: ${subgraphOption}. Expected format is name:subgraph-name,schemaPath:path-to-schema,labels:key=value key=value.`,
            ),
          ),
        );
      }

      const resolvedSchemaPath = resolve(params.schemaPath);
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
      subgraphs.push({
        name: params.name,
        schemaSDL: schema,
        isDeleted: false,
        isNew: true,
        labels,
      });
    }

    // Process subgraphs to delete in the proposal
    for (const subgraphName of options.deletedSubgraph) {
      subgraphs.push({
        name: subgraphName,
        schemaSDL: '',
        isDeleted: true,
        isNew: false,
        labels: [],
      });
    }

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
