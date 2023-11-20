import { readFile } from 'node:fs/promises';

import { Command } from 'commander';
import pc from 'picocolors';

import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PublishedOperationStatus } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

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
  command.requiredOption('-c, --client <client-name>', 'The client identifier to register the operations to');
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
        clientName: options.client,
        operations,
      },
      { headers: baseHeaders },
    );
    if (result.response?.code === EnumStatusCode.OK) {
      const upToDate = (result.operations?.filter((op) => op.status === PublishedOperationStatus.UP_TO_DATE) ?? [])
        .length;
      const created = (result.operations?.filter((op) => op.status === PublishedOperationStatus.CREATED) ?? []).length;
      console.log(
        pc.green(`pushed ${result.operations?.length ?? 0} operations: ${created} created, ${upToDate} up to date`),
      );
    } else {
      command.error(pc.red(`could not push operations: ${result.response?.details ?? 'unknown error'}`));
    }
  });
  return command;
};
