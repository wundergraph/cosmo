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
  response: GetProposalsResponse | ((req: GetProposalsByFederatedGraphRequest) => GetProposalsResponse),
  onGetProposals?: (req: GetProposalsByFederatedGraphRequest) => void,
) {
  return createRouterTransport(({ service }) => {
    service(PlatformService, {
      getProposalsByFederatedGraph: (req) => {
        onGetProposals?.(req);
        return typeof response === 'function' ? response(req) : response;
      },
    });
  });
}

async function runStatus(
  response: GetProposalsResponse | ((req: GetProposalsByFederatedGraphRequest) => GetProposalsResponse),
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
      limit: 50,
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

  test('only checks the 50 most recent proposals by default', async () => {
    let requestCount = 0;

    await runStatus(
      {
        response: { code: EnumStatusCode.OK },
        proposals: [{ name: 'another-proposal', state: 'DRAFT' }],
        totalCount: 51,
      },
      ['--json'],
      () => {
        requestCount++;
      },
    );

    expect(requestCount).toBe(1);
    expect(process.exitCode).toBe(1);
  });

  test('checks subsequent pages when --check-all-proposals is set', async () => {
    const requestedOffsets: number[] = [];

    await runStatus(
      (req) => {
        if (req.offset === 0) {
          return {
            response: { code: EnumStatusCode.OK },
            proposals: [{ name: 'another-proposal', state: 'DRAFT' }],
            totalCount: 2,
          };
        }

        return {
          response: { code: EnumStatusCode.OK },
          proposals: [{ name: 'my-proposal', state: 'CLOSED' }],
          totalCount: 2,
        };
      },
      ['--check-all-proposals', '--json'],
      (req) => {
        requestedOffsets.push(req.offset);
      },
    );

    expect(requestedOffsets).toEqual([0, 1]);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ status: 'CLOSED' }));
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
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
