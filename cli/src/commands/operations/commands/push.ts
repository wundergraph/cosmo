import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Command } from 'commander';
import pc from 'picocolors';

import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PublishedOperationStatus, PersistedOperation } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

import { BaseCommandOptions } from '../../../core/types/types.js';
import { baseHeaders } from '../../../core/config.js';

type OperationOutputStatus = 'created' | 'up_to_date' | 'conflict';

interface OperationOutput {
  hash: string;
  contents: string;
  status: OperationOutputStatus;
  operationNames: string[];
}

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

const parseApolloPersistedQueryManifest = (data: ApolloPersistedQueryManifest): PersistedOperation[] => {
  if (data.version !== 1) {
    throw new Error(`unknown Apollo persisted query manifest version ${data.version}`);
  }
  return (
    data.operations
      ?.filter((op) => op.id && op.body)
      .map((op) => new PersistedOperation({ id: op.id, contents: op.body })) ?? []
  );
};

const isRelayQueryMap = (data: any): boolean => {
  // Check if all elements are 2-element arrays of strings. In that case
  // the data is a relay query map
  return (
    Array.isArray(data) &&
    data.length ===
      data.filter((x) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && typeof x[1] === 'string')
        .length
  );
};

const parseRelayQueryMap = (data: Array<any>): PersistedOperation[] => {
  return data.map((x: any) => new PersistedOperation({ id: x[0], contents: x[1] }));
};

const isRelayQueryObject = (data: any): boolean => {
  return Object.keys(data).every((key) => typeof key === 'string' && typeof data[key] === 'string');
};

const parseRelayQueryObject = (data: any): PersistedOperation[] => {
  return Object.keys(data).map((key) => new PersistedOperation({ id: key, contents: data[key] }));
};

const parseOperationsJson = (data: any): PersistedOperation[] => {
  if (data.format === 'apollo-persisted-query-manifest') {
    return parseApolloPersistedQueryManifest(data);
  }
  if (isRelayQueryMap(data)) {
    return parseRelayQueryMap(data);
  }
  if (isRelayQueryObject(data)) {
    return parseRelayQueryObject(data);
  }
  throw new Error(`unknown data format`);
};

const humanReadableOperationStatus = (status: PublishedOperationStatus): string => {
  switch (status) {
    case PublishedOperationStatus.CREATED: {
      return 'created';
    }
    case PublishedOperationStatus.UP_TO_DATE: {
      return 'up to date';
    }
    case PublishedOperationStatus.CONFLICT: {
      return 'conflict';
    }
  }
  throw new Error('unknown operation status');
};

const jsonOperationStatus = (status: PublishedOperationStatus): OperationOutputStatus => {
  switch (status) {
    case PublishedOperationStatus.CREATED: {
      return 'created';
    }
    case PublishedOperationStatus.UP_TO_DATE: {
      return 'up_to_date';
    }
    case PublishedOperationStatus.CONFLICT: {
      return 'conflict';
    }
  }
  throw new Error('unknown operation status');
};

export const parseOperations = (contents: string): PersistedOperation[] => {
  let data: any;
  try {
    data = JSON.parse(contents);
  } catch {
    // Assume it's plain graphql
    const id = crypto.createHash('sha256').update(contents).digest('hex');
    return [new PersistedOperation({ id, contents })];
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
  command.option('-ns, --namespace', 'The namespace of the federated graph. Fallback to "default"', 'default');
  command.option('-q, --quiet', 'Do not print any output', false);
  command.option('--allow-conflicts', 'Exit with success even if there are conflicts', false);
  command.option('--format <output-format>', 'Output format: supported ones are text and json', 'text');
  command.action(async (name, options) => {
    if (options.file.length === 0) {
      command.error(pc.red('No files provided'));
    }
    const operations: PersistedOperation[] = [];
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
        fedGraphName: name,
        namespace: options.namespace,
        clientName: options.client,
        operations,
      },
      { headers: baseHeaders },
    );
    if (result.response?.code === EnumStatusCode.OK) {
      if (options.quiet) {
        return;
      }
      switch (options.format) {
        case 'text': {
          for (const op of result.operations) {
            const message: string[] = [`pushed operation ${op.id}`];
            if (op.hash !== op.id) {
              message.push(`(${op.hash})`);
            }
            message.push(`(${humanReadableOperationStatus(op.status)})`);
            if (op.operationNames.length > 0) {
              message.push(`: ${op.operationNames.join(', ')}`);
            }
            console.log(message.join(' '));
          }
          const upToDate = (result.operations?.filter((op) => op.status === PublishedOperationStatus.UP_TO_DATE) ?? [])
            .length;
          const created = (result.operations?.filter((op) => op.status === PublishedOperationStatus.CREATED) ?? [])
            .length;
          const conflict = (result.operations?.filter((op) => op.status === PublishedOperationStatus.CONFLICT) ?? [])
            .length;
          const color = conflict === 0 ? pc.green : pc.yellow;
          console.log(
            color(
              `pushed ${
                result.operations?.length ?? 0
              } operations: ${created} created, ${upToDate} up to date, ${conflict} conflicts`,
            ),
          );
          if (conflict > 0 && !options.allowConflicts) {
            command.error(pc.red('conflicts detected'));
          }
          break;
        }
        case 'json': {
          const returnedOperations: Record<string, OperationOutput> = {};
          for (let ii = 0; ii < result.operations.length; ii++) {
            const op = result.operations[ii];

            returnedOperations[op.id] = {
              hash: op.hash,
              contents: operations[ii].contents,
              status: jsonOperationStatus(op.status),
              operationNames: op.operationNames ?? [],
            };
          }
          console.log(JSON.stringify(returnedOperations, null, 2));
          break;
        }
      }
    } else {
      command.error(pc.red(`could not push operations: ${result.response?.details ?? 'unknown error'}`));
    }
  });
  return command;
};
