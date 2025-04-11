import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { program } from 'commander';
import pc from 'picocolors';
import { resolve } from 'pathe';
import { Label } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { splitLabel } from '@wundergraph/cosmo-shared';

// Define interfaces for parsing parameters
interface SubgraphParams {
  name: string;
  schemaPath: string;
  [key: string]: string;
}

export const processProposalSubgraphs = async ({
  subgraphs,
  newSubgraphs,
  deletedSubgraphs,
}: {
  subgraphs: string[];
  newSubgraphs: string[];
  deletedSubgraphs: string[];
}) => {
  const processedSubgraphs = [];
  // Process subgraphs to include in the proposal
  for (const subgraphOption of subgraphs) {
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
    processedSubgraphs.push({
      name: params.name,
      schemaSDL: schema,
      isDeleted: false,
      isNew: false,
      labels: [],
    });
  }

  // Process new subgraphs with labels
  for (const subgraphOption of newSubgraphs || []) {
    const parts = subgraphOption.split(',');
    const params: SubgraphParams = { name: '', schemaPath: '' };
    let labels: Label[] = [];

    for (const part of parts) {
      if (part.startsWith('labels:')) {
        const labelsStr = part.slice('labels:'.length);
        const labelStrings = labelsStr.trim().split(' ');
        labels = labelStrings.map((label: string) => new Label(splitLabel(label)));
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
    processedSubgraphs.push({
      name: params.name,
      schemaSDL: schema,
      isDeleted: false,
      isNew: true,
      labels,
    });
  }

  // Process subgraphs to delete in the proposal
  for (const subgraphName of deletedSubgraphs) {
    processedSubgraphs.push({
      name: subgraphName,
      schemaSDL: '',
      isDeleted: true,
      isNew: false,
      labels: [],
    });
  }

  return processedSubgraphs;
};
