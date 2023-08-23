import { describe, test } from 'vitest';
import { Command } from 'commander';
import { createPromiseClient, createRouterTransport } from '@bufbuild/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common_pb';
import { Client } from '../src/core/client/client';
import PublishSchema from '../src/commands/subgraph/commands/publish';

export const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {
      publishFederatedSubgraph: (ctx) => {
        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      },
    });
  });

describe('Schema Command', () => {
  test('Publish Schema', () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
      node: null,
    };

    const program = new Command();

    program.addCommand(
      PublishSchema({
        client,
      }),
    );
    const command = program.parse(['publish', 'wg.orders', '--schema', 'test/fixtures/schema.graphql'], {
      from: 'user',
    });
  });
});
