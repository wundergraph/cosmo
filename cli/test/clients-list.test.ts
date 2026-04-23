import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { type PartialMessage } from '@bufbuild/protobuf';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { GetClientsResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import ListClientsCommand from '../src/commands/clients/commands/list.js';
import { Client } from '../src/core/client/client.js';

function createMockTransport(response: PartialMessage<GetClientsResponse>, onGetClients?: (req: any) => void) {
  return createRouterTransport(({ service }) => {
    service(PlatformService, {
      getClients: (req) => {
        onGetClients?.(req);
        return response;
      },
    });
  });
}

async function runList(
  response: PartialMessage<GetClientsResponse>,
  args: string[] = [],
  onGetClients?: (req: any) => void,
): Promise<void> {
  const client: Client = {
    platform: createPromiseClient(PlatformService, createMockTransport(response, onGetClients)),
  };
  const program = new Command();
  program.exitOverride();
  program.addCommand(ListClientsCommand({ client }));
  await program.parseAsync(['list', 'mygraph', ...args], { from: 'user' });
}

function getJsonOutput(logSpy: MockInstance<typeof console.log>) {
  const call = logSpy.mock.calls.find(([arg]) => {
    try {
      JSON.parse(String(arg));
      return true;
    } catch {
      return false;
    }
  });

  if (!call) {
    throw new Error('No JSON output found in console.log calls');
  }

  return JSON.parse(String(call[0]));
}

describe('stdout', () => {
  let logSpy: MockInstance<typeof console.log>;
  let stderrSpy: MockInstance<typeof process.stderr.write>;
  let exitSpy: MockInstance<typeof process.exit>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  test('prints clients table', async () => {
    await runList({
      response: { code: EnumStatusCode.OK },
      clients: [
        {
          id: 'client-id',
          name: 'web',
          createdAt: '2026-04-23T10:00:00.000Z',
          lastUpdatedAt: '2026-04-24T10:00:00.000Z',
          createdBy: 'a@b.com',
          lastUpdatedBy: 'c@d.com',
        },
      ],
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toContain('NAME');
    expect(String(logSpy.mock.calls[0][0])).toContain('CREATED_AT');
    expect(String(logSpy.mock.calls[0][0])).toContain('LAST_PUSH');
    expect(String(logSpy.mock.calls[0][0])).toContain('web');
    expect(String(logSpy.mock.calls[0][0])).toContain('2026-04-23T10:00:00.000Z');
    expect(String(logSpy.mock.calls[0][0])).toContain('2026-04-24T10:00:00.000Z');
    expect(String(logSpy.mock.calls[0][0])).not.toContain('client-id');
  });

  test('uses default namespace when not provided', async () => {
    let requestNamespace = '';

    await runList(
      {
        response: { code: EnumStatusCode.OK },
        clients: [],
      },
      [],
      (req) => {
        requestNamespace = req.namespace;
      },
    );

    expect(requestNamespace).toBe('default');
  });

  test('prints empty message', async () => {
    await runList({
      response: { code: EnumStatusCode.OK },
      clients: [],
    });

    expect(logSpy).toHaveBeenCalledWith('No clients found');
  });

  test('fails on rpc error', async () => {
    await expect(
      runList({
        response: { code: EnumStatusCode.ERR, details: 'boom' },
        clients: [],
      }),
    ).rejects.toThrow();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(stderrSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalled();
  });
});

describe('json output', () => {
  let logSpy: MockInstance<typeof console.log>;
  let stderrSpy: MockInstance<typeof process.stderr.write>;
  let exitSpy: MockInstance<typeof process.exit>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  test('prints clients as raw json', async () => {
    await runList(
      {
        response: { code: EnumStatusCode.OK },
        clients: [
          {
            id: 'client-id',
            name: 'web',
            createdAt: '2026-04-23T10:00:00.000Z',
            lastUpdatedAt: '',
            createdBy: 'a@b.com',
            lastUpdatedBy: '',
          },
        ],
      },
      ['--json'],
    );

    expect(getJsonOutput(logSpy)).toEqual({
      status: 'success',
      clients: [
        {
          id: 'client-id',
          name: 'web',
          createdAt: '2026-04-23T10:00:00.000Z',
          lastUpdatedAt: '',
          createdBy: 'a@b.com',
          lastUpdatedBy: '',
        },
      ],
    });
  });

  test('prints empty clients json when no clients found', async () => {
    await runList(
      {
        response: { code: EnumStatusCode.OK },
        clients: [],
      },
      ['--json'],
    );

    expect(getJsonOutput(logSpy)).toEqual({
      status: 'success',
      clients: [],
    });
  });

  test('prints error json on rpc error', async () => {
    await runList(
      {
        response: { code: EnumStatusCode.ERR, details: 'boom' },
        clients: [],
      },
      ['--json'],
    );

    expect(getJsonOutput(logSpy)).toEqual({
      status: 'error',
      code: EnumStatusCode.ERR,
      message: 'Could not fetch clients.',
      details: 'boom',
    });
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
