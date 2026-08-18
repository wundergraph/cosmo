import { type MessageInitShape } from '@bufbuild/protobuf';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  type GetProposalsByFederatedGraphRequest,
  GetProposalsByFederatedGraphResponseSchema,
  PlatformService,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import StatusProposalCommand from '../src/commands/proposal/commands/status.js';
import { Client } from '../src/core/client/client.js';

type GetProposalsResponse = MessageInitShape<typeof GetProposalsByFederatedGraphResponseSchema>;

function createMockTransport(
  response: GetProposalsResponse,
  onGetProposals?: (req: GetProposalsByFederatedGraphRequest) => void,
) {
  return createRouterTransport(({ service }) => {
    service(PlatformService, {
      getProposalsByFederatedGraph: (req) => {
        onGetProposals?.(req);
        return response;
      },
    });
  });
}

async function runStatus(
  response: GetProposalsResponse,
  args: string[] = [],
  onGetProposals?: (req: GetProposalsByFederatedGraphRequest) => void,
): Promise<void> {
  const client: Client = {
    platform: createClient(PlatformService, createMockTransport(response, onGetProposals)),
  };
  const program = new Command();
  program.exitOverride();
  program.addCommand(StatusProposalCommand({ client }));
  await program.parseAsync(['status', 'my-proposal', '--federation-graph', 'my-graph', ...args], { from: 'user' });
}

describe('proposal status', () => {
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

  test('prints the proposal status as text', async () => {
    let request: GetProposalsByFederatedGraphRequest | undefined;

    await runStatus(
      {
        response: { code: EnumStatusCode.OK },
        proposals: [{ name: 'my-proposal', state: 'DRAFT' }],
        totalCount: 1,
      },
      ['--namespace', 'production'],
      (req) => {
        request = req;
      },
    );

    expect(request).toMatchObject({
      federatedGraphName: 'my-graph',
      namespace: 'production',
      proposalName: 'my-proposal',
      limit: 1,
      offset: 0,
    });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Proposal 'my-proposal' status is DRAFT."));
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  test('prints the proposal status as json', async () => {
    await runStatus(
      {
        response: { code: EnumStatusCode.OK },
        proposals: [{ name: 'my-proposal', state: 'APPROVED' }],
        totalCount: 1,
      },
      ['--json'],
    );

    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ status: 'APPROVED' }));
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  test('uses the default namespace when none is specified', async () => {
    let request: GetProposalsByFederatedGraphRequest | undefined;

    await runStatus(
      {
        response: { code: EnumStatusCode.OK },
        proposals: [{ name: 'my-proposal', state: 'DRAFT' }],
        totalCount: 1,
      },
      [],
      (req) => {
        request = req;
      },
    );

    expect(request?.namespace).toBe('default');
  });

  test('prints a json error and sets a non-zero exit code when the proposal is not found', async () => {
    await runStatus(
      {
        response: { code: EnumStatusCode.OK },
        proposals: [],
        totalCount: 0,
      },
      ['--json'],
    );

    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
      status: 'error',
      details: "Proposal 'my-proposal' not found.",
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test('prints the control-plane error and sets a non-zero exit code', async () => {
    await runStatus({
      response: {
        code: EnumStatusCode.ERR_NOT_FOUND,
        details: 'Federated graph my-graph not found',
      },
      proposals: [],
      totalCount: 0,
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Federated graph my-graph not found'));
    expect(logSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
