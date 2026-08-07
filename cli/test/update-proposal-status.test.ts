import { type MessageInitShape } from '@bufbuild/protobuf';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  PlatformService,
  type UpdateProposalRequest,
  UpdateProposalResponseSchema,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import UpdateProposalStatusCommand from '../src/commands/proposal/commands/update-status.js';
import { Client } from '../src/core/client/client.js';

function createMockTransport(
  response: MessageInitShape<typeof UpdateProposalResponseSchema>,
  onUpdateProposal?: (req: UpdateProposalRequest) => void,
) {
  return createRouterTransport(({ service }) => {
    service(PlatformService, {
      updateProposal: (req) => {
        onUpdateProposal?.(req);
        return response;
      },
    });
  });
}

async function runUpdateStatus(
  response: MessageInitShape<typeof UpdateProposalResponseSchema>,
  args: string[] = [],
  onUpdateProposal?: (req: UpdateProposalRequest) => void,
): Promise<void> {
  const client: Client = {
    platform: createClient(PlatformService, createMockTransport(response, onUpdateProposal)),
  };
  const program = new Command();
  program.exitOverride();
  const command = UpdateProposalStatusCommand({ client });
  command.exitOverride();
  program.addCommand(command);
  await program.parseAsync(
    ['update-status', 'my-proposal', '--federation-graph', 'my-graph', '--status', 'approved', ...args],
    { from: 'user' },
  );
}

describe('update proposal status', () => {
  let logSpy: MockInstance<typeof console.log>;
  let errorSpy: MockInstance<typeof console.error>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  test('approves a proposal in the default namespace', async () => {
    let request: UpdateProposalRequest | undefined;

    await runUpdateStatus({ response: { code: EnumStatusCode.OK } }, [], (req) => {
      request = req;
    });

    expect(request).toMatchObject({
      proposalName: 'my-proposal',
      federatedGraphName: 'my-graph',
      namespace: 'default',
      updateAction: {
        case: 'state',
        value: 'APPROVED',
      },
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Proposal 'my-proposal' status was updated to APPROVED successfully."),
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  test('closes a proposal in an explicitly provided namespace', async () => {
    let request: UpdateProposalRequest | undefined;

    await runUpdateStatus(
      { response: { code: EnumStatusCode.OK } },
      ['--status', 'CLOSED', '--namespace', 'production'],
      (req) => {
        request = req;
      },
    );

    expect(request).toMatchObject({
      namespace: 'production',
      updateAction: {
        case: 'state',
        value: 'CLOSED',
      },
    });
  });

  test('rejects statuses that cannot be set manually', async () => {
    let updateCalled = false;

    await expect(
      runUpdateStatus({ response: { code: EnumStatusCode.OK } }, ['--status', 'published'], () => {
        updateCalled = true;
      }),
    ).rejects.toThrow('Allowed values are approved and closed.');

    expect(updateCalled).toBe(false);
  });

  test('prints the control-plane error and sets a non-zero exit code', async () => {
    await runUpdateStatus({
      response: {
        code: EnumStatusCode.ERR_NOT_FOUND,
        details: 'Proposal my-proposal not found',
      },
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Proposal my-proposal not found'));
    expect(logSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
