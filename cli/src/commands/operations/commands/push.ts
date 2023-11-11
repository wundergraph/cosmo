import { readFile } from 'node:fs/promises';

import { Command } from 'commander';
import pc from 'picocolors';

import { BaseCommandOptions } from '../../../core/types/types';
import { baseHeaders } from '../../../core/config.js';

const collect = (value: string, previous: string[]): string[] => {
  return [...previous, value];
};

interface ApolloPersistedQueryManifest {
  format: 'apollo-persisted-query-manifest';
  version?: number;
  operations?: [
    {
      id?: string;
      name?: string;
      type?: string;
      body?: string;
    },
  ];
}

const parseApolloPersistedQueryManifest = (data: ApolloPersistedQueryManifest): string[] => {
  if (data.version !== 1) {
    throw new Error(`unknown Apollo persisted query manifest version ${data.version}`);
  }
  return data.operations?.map((op) => op.body).filter((x): x is string => !!x) ?? [];
};

const parseOperationsJson = (data: any): string[] => {
  if (data.format === 'apollo-persisted-query-manifest') {
    return parseApolloPersistedQueryManifest(data);
  }
  // Check if all elements are 2-element arrays of strings. In that case
  // the data is a relay query map
  if (
    Array.isArray(data) &&
    data.length ===
      data.filter((x) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && typeof x[1] === 'string')
        .length
  ) {
    return data.map((x) => x[1]).filter((x): x is string => !!x);
  }
  throw new Error(`unknown data format`);
};

export const parseOperations = (contents: string): string[] => {
  let data: any;
  try {
    data = JSON.parse(contents);
  } catch {
    // Assume it's plain graphql
    return [contents];
  }
  return parseOperationsJson(data);
};

export default (opts: BaseCommandOptions) => {
  const command = new Command('push');
  command.description('Pushes new operations to the registry');
  command.argument('<graph_name>', 'The name of the federated graph on which the check operations are stored.');
  command.requiredOption('-c, --client-id <client-id>', 'The client identifier to register the operations to');
  command.requiredOption(
    '-f, --file <file>',
    'The file with the operations to push - supports .graphql, .gql and .json manifests from Apollo and Relay',
    collect,
    [],
  );
  command.action(async (name, options) => {
    if (options.file.length === 0) {
      command.error(pc.red('No files provided'));
    }
    const operations: string[] = [];
    for (const file of options.file) {
      const contents = await readFile(file, 'utf8');
      try {
        operations.push(...parseOperations(contents));
      } catch (e: any) {
        command.error(pc.red(`Failed to parse ${file}: ${e.message}`));
      }
    }

    const result = await opts.client.platform.publishPersistedOperations(
      {
        graphName: name,
        clientName: options.clientId,
        operations,
      },
      { headers: baseHeaders },
    );
    console.log('pushing operations', result);
  });
  return command;
};
