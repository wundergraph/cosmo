import { describe, test } from 'vitest';
import { Command } from 'commander';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Client } from '../src/core/client/client.js';
import CheckFederatedGraph from '../src/commands/graph/federated-graph/commands/check.js';

export const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {
      checkFederatedGraph: (ctx) => {
        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      },
    });
  });

describe('Schema Command', () => {
  test('Check federated graph', () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const program = new Command();

    program.addCommand(
      CheckFederatedGraph({
        client,
      }),
    );
    const command = program.parse(['check', 'wg.orders', '--label-matcher', 'team=A'], {
      from: 'user',
    });
  });
});
