import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { type CreateProposalRequest, PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import CreateProposalCommand from '../src/commands/proposal/commands/create.js';
import { Client } from '../src/core/client/client.js';
import { config } from '../src/core/config.js';

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  authorization: string | undefined;
}

const startFakeHub = async (toolResult: object): Promise<{ server: Server; url: string; calls: ToolCall[] }> => {
  const calls: ToolCall[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const message = JSON.parse(body);
      if (message.method === 'initialize') {
        response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'session-1' });
        response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18' } }));
        return;
      }
      if (message.method === 'notifications/initialized') {
        response.writeHead(202);
        response.end();
        return;
      }
      calls.push({
        name: message.params.name,
        arguments: message.params.arguments,
        authorization: request.headers.authorization,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [], structuredContent: toolResult },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}`, calls };
};

const openCosmoTarget = {
  kind: 'cosmo',
  status: 'open',
  externalRef: 'https://cosmo.wundergraph.com/acme/default/graph/products/proposals/p-42',
  detail: null,
};

const proposalResult = (cosmoTarget: object) => ({
  proposalId: 'hp-7',
  proposalUrl: 'https://hub.example.com/acme/proposals/hp-7',
  targets: [{ kind: 'hub', status: 'open', externalRef: null, detail: null }, cosmoTarget],
});

const runCreate = async (args: string[], onCreateProposal?: (request: CreateProposalRequest) => void) => {
  const client: Client = {
    platform: createClient(
      PlatformService,
      createRouterTransport(({ service }) => {
        service(PlatformService, {
          createProposal: (request) => {
            onCreateProposal?.(request);
            return { response: { code: EnumStatusCode.OK }, proposalId: 'p-1' };
          },
        });
      }),
    ),
  };
  const create = CreateProposalCommand({ client });
  create.exitOverride();
  const program = new Command();
  program.exitOverride();
  program.addCommand(create);
  await program.parseAsync(['create', ...args], { from: 'user' });
};

describe('proposal create --hub-sandbox', () => {
  let server: Server | undefined;
  let stdout: MockInstance<typeof process.stdout.write>;
  let stderr: MockInstance<typeof process.stderr.write>;
  const originalHubUrl = config.hubURL;

  beforeEach(() => {
    vi.stubEnv('GITLAB_CI', 'true');
    vi.stubEnv('HUB_ID_TOKEN', 'hub-ci-token');
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    config.hubURL = originalHubUrl;
    process.exitCode = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  const useFakeHub = async (toolResult: object) => {
    const hub = await startFakeHub(toolResult);
    server = hub.server;
    config.hubURL = hub.url;
    return hub;
  };

  test('calls Hub propose with the sandbox and prints the Hub URL and Cosmo reference', async () => {
    const hub = await useFakeHub(proposalResult(openCosmoTarget));

    await runCreate(['--hub-sandbox', 'products/feature-x']);

    expect(hub.calls).toEqual([
      {
        name: 'propose',
        arguments: { sandbox: 'products/feature-x', targets: ['cosmo'] },
        authorization: 'Bearer hub-ci-token',
      },
    ]);
    expect(stdout.mock.calls.map(([chunk]) => chunk).join('')).toBe(
      [
        'Hub proposal hp-7 created.',
        '  Hub:   https://hub.example.com/acme/proposals/hp-7',
        '  Cosmo: https://cosmo.wundergraph.com/acme/default/graph/products/proposals/p-42 (open)',
        '',
      ].join('\n'),
    );
    expect(process.exitCode).toBeUndefined();
  });

  test('prints the result as JSON and progress as NDJSON on stderr', async () => {
    await useFakeHub(proposalResult(openCosmoTarget));

    await runCreate(['--hub-sandbox', 'products/feature-x', '--json']);

    expect(JSON.parse(String(stdout.mock.calls[0][0]))).toEqual({
      status: 'success',
      ...proposalResult(openCosmoTarget),
    });
    expect(JSON.parse(String(stderr.mock.calls[0][0]))).toEqual({
      event: 'progress',
      step: 'propose',
      subject: 'products/feature-x',
      message: 'Creating the Hub and Cosmo proposals',
    });
  });

  test('fails when the Cosmo target failed', async () => {
    await useFakeHub(
      proposalResult({ kind: 'cosmo', status: 'failed', externalRef: null, detail: 'composition failed' }),
    );

    await runCreate(['--hub-sandbox', 'products/feature-x', '--json']);

    expect(JSON.parse(String(stdout.mock.calls[0][0]))).toEqual({
      status: 'error',
      error: {
        message:
          'Hub created https://hub.example.com/acme/proposals/hp-7 but the Cosmo proposal failed: composition failed',
        input: 'products/feature-x',
        fix: 'Fix the reported problem in the sandbox, then propose again.',
      },
    });
    expect(process.exitCode).toBe(1);
  });

  test('rejects a proposal name, since Hub names the proposal', async () => {
    const hub = await useFakeHub(proposalResult(openCosmoTarget));

    await expect(runCreate(['add-reviews', '--hub-sandbox', 'products/feature-x'])).rejects.toThrow(
      'error: Hub names proposals created with --hub-sandbox. Drop the name argument.',
    );
    expect(hub.calls).toEqual([]);
  });

  test('rejects a sandbox reference without a schema', async () => {
    const hub = await useFakeHub(proposalResult(openCosmoTarget));

    await runCreate(['--hub-sandbox', 'feature-x', '--json']);

    expect(JSON.parse(String(stdout.mock.calls[0][0]))).toEqual({
      status: 'error',
      error: {
        message: 'The --hub-sandbox value is not a sandbox reference.',
        input: 'feature-x',
        fix: 'Expected <schema>/<sandbox>, e.g. products/add-reviews.',
      },
    });
    expect(hub.calls).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  test('fails when Hub returns an unexpected shape', async () => {
    await useFakeHub({ targets: [] });

    await runCreate(['--hub-sandbox', 'products/feature-x', '--json']);

    const printed = JSON.parse(String(stdout.mock.calls[0][0]));
    expect(printed.status).toBe('error');
    expect(printed.error.message.startsWith('Hub tool propose returned an unexpected shape:')).toBe(true);
    expect(process.exitCode).toBe(1);
  });
});

describe('proposal create without --hub-sandbox', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  test('still requires the federated graph', async () => {
    await expect(runCreate(['my-proposal', '--subgraph', 'name:products,schemaPath:x.graphql'])).rejects.toThrow(
      "error: required option '-f, --federation-graph <federatedGraphName>' not specified",
    );
  });

  test('still requires the proposal name', async () => {
    await expect(runCreate(['-f', 'my-graph'])).rejects.toThrow("error: missing required argument 'name'");
  });

  test('creates the Cosmo proposal for the federated graph', async () => {
    let request: CreateProposalRequest | undefined;

    await runCreate(['my-proposal', '-f', 'my-graph', '--deleted-subgraph', 'reviews'], (received) => {
      request = received;
    });

    expect(request?.federatedGraphName).toBe('my-graph');
    expect(request?.name).toBe('my-proposal');
    expect(request?.subgraphs.map((subgraph) => [subgraph.name, subgraph.isDeleted])).toEqual([['reviews', true]]);
  });
});
