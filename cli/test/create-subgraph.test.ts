import { describe, test } from 'vitest';
import { Command } from 'commander';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Client } from '../src/core/client/client.js';
import CreateSubgraphCommand from '../src/commands/subgraph/commands/create.js';

export const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {
      createFederatedSubgraph: (ctx) => {
        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      },
    });
  });

describe('Schema Command', () => {
  test('Create subgraph', () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const program = new Command();

    program.addCommand(
      CreateSubgraphCommand({
        client,
      }),
    );
    const command = program.parse(
      ['create', 'wg.orders', '--routing-url', 'http://localhost:4000/graphql', '--label', 'user'],
      {
        from: 'user',
      },
    );
  });
});
