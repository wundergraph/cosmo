import { describe, test } from 'vitest';
import { Command } from 'commander';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Client } from '../src/core/client/client.js';
import CheckSchema from '../src/commands/subgraph/commands/check.js';

export const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {
      checkSubgraphSchema: (ctx) => {
        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      },
      isGitHubAppInstalled: (ctx) => {
        return {
          response: {
            code: EnumStatusCode.OK,
          },
          isInstalled: false,
        };
      },
    });
  });

describe('Schema Command', () => {
  test('Check subgraph schema', () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const program = new Command();

    program.addCommand(
      CheckSchema({
        client,
      }),
    );
    const command = program.parse(['check', 'wg.orders', '--schema', 'test/fixtures/schema.graphql'], {
      from: 'user',
    });
  });
});
