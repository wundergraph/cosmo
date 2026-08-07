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
import ApproveProposalCommand from '../src/commands/proposal/commands/approve.js';
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

async function runApprove(
  response: MessageInitShape<typeof UpdateProposalResponseSchema>,
  args: string[] = [],
  onUpdateProposal?: (req: UpdateProposalRequest) => void,
): Promise<void> {
  const client: Client = {
    platform: createClient(PlatformService, createMockTransport(response, onUpdateProposal)),
  };
  const program = new Command();
  program.exitOverride();
  program.addCommand(ApproveProposalCommand({ client }));
  await program.parseAsync(['approve', 'my-proposal', '--federation-graph', 'my-graph', ...args], { from: 'user' });
}

describe('approve proposal', () => {
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

    await runApprove({ response: { code: EnumStatusCode.OK } }, [], (req) => {
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
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Proposal 'my-proposal' was approved successfully."));
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  test('approves a proposal in an explicitly provided namespace', async () => {
    let namespace = '';

    await runApprove({ response: { code: EnumStatusCode.OK } }, ['--namespace', 'production'], (req) => {
      namespace = req.namespace;
    });

    expect(namespace).toBe('production');
  });

  test('prints the control-plane error and sets a non-zero exit code', async () => {
    await runApprove({
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
