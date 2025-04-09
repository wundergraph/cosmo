import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Command, program } from 'commander';
import ora from 'ora';
import { resolve } from 'pathe';
import pc from 'picocolors';
import { Label } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb.js';
import { splitLabel } from '@wundergraph/cosmo-shared';
import { BaseCommandOptions } from '../../../core/types/types.js';
import { getBaseHeaders } from '../../../core/config.js';
import { handleProposalResult } from '../../../handle-proposal-result.js';

// Define interfaces for parsing parameters
interface SubgraphParams {
  name: string;
  schemaPath: string;
  [key: string]: string;
}

interface LabelMap {
  [key: string]: string;
}

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

    const updatedSubgraphs = [];

    // Process subgraphs to update
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

      updatedSubgraphs.push({
        name: params.name,
        schemaSDL: schema,
        isDeleted: false,
      });
    }

    // Process new subgraphs to add
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
      updatedSubgraphs.push({
        name: params.name,
        schemaSDL: schema,
        isDeleted: false,
        labels,
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
