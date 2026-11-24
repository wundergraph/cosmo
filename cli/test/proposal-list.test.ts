import { type MessageInitShape } from '@bufbuild/protobuf';
import { Code, ConnectError, createClient, createRouterTransport } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  type GetProposalsByFederatedGraphRequest,
  GetProposalsByFederatedGraphResponseSchema,
  PlatformService,
  type ProposalSchema,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import ListProposalCommand from '../src/commands/proposal/commands/list.js';
import { Client } from '../src/core/client/client.js';
import { getJsonOutput } from './utils.js';

type GetProposalsResponse = MessageInitShape<typeof GetProposalsByFederatedGraphResponseSchema>;
type ProposalInit = MessageInitShape<typeof ProposalSchema>;

const proposal = (name: string, state: string): ProposalInit => ({
  id: `${name}-id`,
  name,
  state,
  createdAt: '2026-11-01T10:00:00.000Z',
  createdByEmail: 'dev@example.com',
  federatedGraphName: 'my-graph',
  subgraphs: [{ name: 'products', schemaSDL: 'type Query { a: String }' }],
  latestCheckSuccess: true,
  latestCheckId: `${name}-check`,
});

const manyProposals = (count: number) => Array.from({ length: count }, (_, i) => proposal(`p-${i}`, 'DRAFT'));

function respondInPages(proposals: ProposalInit[]) {
  return (req: GetProposalsByFederatedGraphRequest): GetProposalsResponse => ({
    response: { code: EnumStatusCode.OK },
    proposals: proposals.slice(req.offset, req.offset + req.limit),
    totalCount: proposals.length,
  });
}

const respondEndlessly = (req: GetProposalsByFederatedGraphRequest): GetProposalsResponse => ({
  response: { code: EnumStatusCode.OK },
  proposals: Array.from({ length: req.limit }, (_, i) => proposal(`p-${req.offset + i}`, 'DRAFT')),
  totalCount: 1_000_000,
});

const respondWithError = (code: EnumStatusCode, details: string) => (): GetProposalsResponse => ({
  response: { code, details },
  proposals: [],
  totalCount: 0,
});

async function runList(
  respond: (req: GetProposalsByFederatedGraphRequest) => GetProposalsResponse,
  args: string[] = [],
): Promise<GetProposalsByFederatedGraphRequest[]> {
  const requests: GetProposalsByFederatedGraphRequest[] = [];
  const transport = createRouterTransport(({ service }) => {
    service(PlatformService, {
      getProposalsByFederatedGraph: (req) => {
        requests.push(req);
        return respond(req);
      },
    });
  });
  const client: Client = { platform: createClient(PlatformService, transport) };
  const program = new Command();
  program.exitOverride();
  program.addCommand(ListProposalCommand({ client }).exitOverride());
  await program.parseAsync(['list', '--federation-graph', 'my-graph', ...args], { from: 'user' });
  return requests;
}

describe('proposal list', () => {
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

  test('requests the given graph and namespace', async () => {
    const requests = await runList(respondInPages([]), ['--namespace', 'production']);

    expect(requests).toMatchObject([{ federatedGraphName: 'my-graph', namespace: 'production', offset: 0 }]);
  });

  test('uses the default namespace when none is specified', async () => {
    const requests = await runList(respondInPages([]));

    expect(requests).toMatchObject([{ namespace: 'default' }]);
  });

  test('fetches every page', async () => {
    const requests = await runList(respondInPages(manyProposals(120)), ['--json']);

    expect(requests).toMatchObject([{ offset: 0 }, { offset: 50 }, { offset: 100 }]);
  });

  test('prints every fetched proposal as json', async () => {
    await runList(respondInPages(manyProposals(120)), ['--json']);

    expect(getJsonOutput(logSpy).proposals).toHaveLength(120);
  });

  test('fails when a proposal is created mid-listing', async () => {
    const beforeCreation = manyProposals(60);
    const afterCreation = [proposal('new', 'DRAFT'), ...beforeCreation];

    await runList((req) => respondInPages(req.offset === 0 ? beforeCreation : afterCreation)(req), ['--json']);

    expect(getJsonOutput(logSpy)).toEqual({
      status: 'error',
      code: EnumStatusCode.ERR,
      message: 'Could not fetch proposals.',
      details: 'The proposals changed while they were being listed. Run the command again.',
    });
  });

  test('fails when a page brings no new proposals before the total is reached', async () => {
    const page = manyProposals(50);

    await runList(() => ({ response: { code: EnumStatusCode.OK }, proposals: page, totalCount: 1000 }), ['--json']);

    expect(getJsonOutput(logSpy)).toEqual({
      status: 'error',
      code: EnumStatusCode.ERR,
      message: 'Could not fetch proposals.',
      details: 'The proposals changed while they were being listed. Run the command again.',
    });
  });

  describe('when the graph has more proposals than the page limit allows', () => {
    test('stops after 200 pages', async () => {
      const requests = await runList(respondEndlessly, ['--json']);

      expect(requests).toHaveLength(200);
    });

    test('prints a json error', async () => {
      await runList(respondEndlessly, ['--json']);

      expect(getJsonOutput(logSpy)).toEqual({
        status: 'error',
        code: EnumStatusCode.ERR,
        message: 'Could not fetch proposals.',
        details: 'The graph has more than 10000 proposals, which is more than this command can list.',
      });
    });
  });

  test('prints each proposal as json', async () => {
    await runList(respondInPages([proposal('a', 'DRAFT')]), ['--json']);

    expect(getJsonOutput(logSpy)).toEqual({
      status: 'success',
      proposals: [
        {
          id: 'a-id',
          name: 'a',
          state: 'DRAFT',
          federatedGraphId: '',
          federatedGraphName: 'my-graph',
          subgraphs: [{ name: 'products', isDeleted: false, isNew: false, labels: [] }],
          createdAt: '2026-11-01T10:00:00.000Z',
          createdByEmail: 'dev@example.com',
          latestCheckSuccess: true,
          latestCheckId: 'a-check',
          origin: 0,
        },
      ],
    });
  });

  test('keeps only proposals with the given statuses', async () => {
    const all = [proposal('a', 'DRAFT'), proposal('b', 'APPROVED'), proposal('c', 'CLOSED')];

    await runList(respondInPages(all), ['--json', '--status', 'draft', 'closed']);

    expect(getJsonOutput(logSpy)).toMatchObject({ status: 'success', proposals: [{ name: 'a' }, { name: 'c' }] });
  });

  test('rejects an unknown status', async () => {
    const run = runList(respondInPages([]), ['--status', 'pending']);

    await expect(run).rejects.toThrow("argument 'pending' is invalid");
  });

  test('rejects an unknown status given alongside a valid one', async () => {
    const run = runList(respondInPages([]), ['--status', 'approved', 'pending']);

    await expect(run).rejects.toThrow("argument 'pending' is invalid");
  });

  test('prints proposal names in a table', async () => {
    await runList(respondInPages([proposal('alpha', 'DRAFT'), proposal('beta', 'APPROVED')]));

    expect(String(logSpy.mock.calls[0][0])).toContain('beta');
  });

  test('prints proposal states in a table', async () => {
    await runList(respondInPages([proposal('alpha', 'DRAFT'), proposal('beta', 'APPROVED')]));

    expect(String(logSpy.mock.calls[0][0])).toContain('APPROVED');
  });

  test('says when there are no proposals', async () => {
    await runList(respondInPages([]));

    expect(logSpy).toHaveBeenCalledWith('No proposals found');
  });

  test('prints a json error on a control-plane error', async () => {
    await runList(respondWithError(EnumStatusCode.ERR, 'Proposals are not enabled for namespace default'), ['--json']);

    expect(getJsonOutput(logSpy)).toEqual({
      status: 'error',
      code: EnumStatusCode.ERR,
      message: 'Could not fetch proposals.',
      details: 'Proposals are not enabled for namespace default',
    });
  });

  test('sets a non-zero exit code on a control-plane error with --json', async () => {
    await runList(respondWithError(EnumStatusCode.ERR, 'Proposals are not enabled for namespace default'), ['--json']);

    expect(process.exitCode).toBe(1);
  });

  test('prints a json error when the control plane cannot be reached', async () => {
    await runList(() => {
      throw new ConnectError('connection refused', Code.Unavailable);
    }, ['--json']);

    expect(getJsonOutput(logSpy)).toEqual({
      status: 'error',
      code: EnumStatusCode.ERR,
      message: 'Could not fetch proposals.',
      details: '[unavailable] connection refused',
    });
  });

  test('prints the control-plane error', async () => {
    await runList(respondWithError(EnumStatusCode.ERR_NOT_FOUND, 'Federated graph my-graph not found'));

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Federated graph my-graph not found'));
  });

  test('sets a non-zero exit code on a control-plane error', async () => {
    await runList(respondWithError(EnumStatusCode.ERR_NOT_FOUND, 'Federated graph my-graph not found'));

    expect(process.exitCode).toBe(1);
  });
});
