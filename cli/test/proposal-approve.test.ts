import { describe, test } from 'vitest';
import { Command } from 'commander';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Client } from '../src/core/client/client.js';
import Approve from '../src/commands/proposal/commands/approve.js';

export const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {
      updateProposal: (ctx, req) => {
        // Return a minimal successful UpdateProposalResponse for handleProposalResult
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

describe('Proposal Command: approve', () => {
  test('approve executes without error', async () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    } as any;

    const program = new Command();
    program.addCommand(
      Approve({
        client,
      }),
    );

    await program.parseAsync(['approve', 'my-proposal', '-f', 'fg', '-n', 'ns'], {
      from: 'user',
    });
  });
});
