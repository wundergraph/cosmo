import { describe, test } from 'vitest';
import { Command } from 'commander';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Client } from '../src/core/client/client.js';
import Close from '../src/commands/proposal/commands/close.js';

export const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {
      updateProposal: (ctx, req) => {
        return {
          response: { code: EnumStatusCode.OK },
          nonBreakingChanges: [],
          breakingChanges: [],
          compositionErrors: [],
          compositionWarnings: [],
          lintErrors: [],
          lintWarnings: [],
          graphPruneErrors: [],
          graphPruneWarnings: [],
        } as any;
      },
    });
  });

describe('Proposal Command: close', () => {
  test('close executes without error', async () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    } as any;

    const program = new Command();
    program.addCommand(
      Close({
        client,
      }),
    );

    await program.parseAsync(['close', 'my-proposal', '-f', 'fg', '-n', 'ns'], {
      from: 'user',
    });
  });
});
