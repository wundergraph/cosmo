import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { type PartialMessage } from '@bufbuild/protobuf';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import {
  DeleteClientResponse,
  PreviewDeleteClientResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import inquirer from 'inquirer';
import DeleteClientsCommand from '../src/commands/clients/commands/delete.js';
import { Client } from '../src/core/client/client.js';

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}));

function createMockTransport(
  previewResponse: PartialMessage<PreviewDeleteClientResponse>,
  deleteResponse: PartialMessage<DeleteClientResponse>,
  onPreviewDeleteClient?: (req: any) => void,
  onDeleteClient?: (req: any) => void,
) {
  return createRouterTransport(({ service }) => {
    service(PlatformService, {
      previewDeleteClient: (req) => {
        onPreviewDeleteClient?.(req);
        return previewResponse;
      },
      deleteClient: (req) => {
        onDeleteClient?.(req);
        return deleteResponse;
      },
    });
  });
}

type RunDeleteOptions = {
  previewResponse: PartialMessage<PreviewDeleteClientResponse>;
  deleteResponse: PartialMessage<DeleteClientResponse>;
  args?: string[];
  onPreviewDeleteClient?: (req: any) => void;
  onDeleteClient?: (req: any) => void;
};

async function runDelete({
  previewResponse,
  deleteResponse,
  args = [],
  onPreviewDeleteClient,
  onDeleteClient,
}: RunDeleteOptions): Promise<void> {
  const client: Client = {
    platform: createPromiseClient(
      PlatformService,
      createMockTransport(previewResponse, deleteResponse, onPreviewDeleteClient, onDeleteClient),
    ),
  };
  const program = new Command();
  program.exitOverride();
  program.addCommand(DeleteClientsCommand({ client }));
  await program.parseAsync(['delete', 'mygraph', 'web', ...args], { from: 'user' });
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

const successPreview = {
  response: { code: EnumStatusCode.OK },
  client: {
    id: 'client-id',
    name: 'web',
    createdAt: '2026-04-23T10:00:00.000Z',
    lastUpdatedAt: '',
    createdBy: 'a@b.com',
    lastUpdatedBy: '',
  },
};

const successDelete = {
  response: { code: EnumStatusCode.OK },
  client: successPreview.client,
  deletedOperationsCount: 0,
  deletedOperations: [],
};

describe('stdout', () => {
  let logSpy: MockInstance<typeof console.log>;
  let stderrSpy: MockInstance<typeof process.stderr.write>;
  let exitSpy: MockInstance<typeof process.exit>;
  const promptMock = vi.mocked(inquirer.prompt);

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    promptMock.mockReset();
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  test('uses default namespace', async () => {
    let previewNamespace = '';
    let deleteNamespace = '';

    await runDelete({
      previewResponse: successPreview,
      deleteResponse: successDelete,
      onPreviewDeleteClient: (req) => {
        previewNamespace = req.namespace;
      },
      onDeleteClient: (req) => {
        deleteNamespace = req.namespace;
      },
    });

    expect(previewNamespace).toBe('default');
    expect(deleteNamespace).toBe('default');
  });

  test('deletes client without prompt when no operations exist', async () => {
    let deleteCalled = false;

    await runDelete({
      previewResponse: successPreview,
      deleteResponse: successDelete,
      onDeleteClient: () => {
        deleteCalled = true;
      },
    });

    expect(promptMock).not.toHaveBeenCalled();
    expect(deleteCalled).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Deleted 0 related persisted operation(s).'));
  });

  test('prompts before deleting client with operations', async () => {
    let deleteCalled = false;
    promptMock.mockResolvedValue({ confirmDeletion: true });

    await runDelete({
      previewResponse: {
        ...successPreview,
        persistedOperationsCount: 2,
      },
      deleteResponse: {
        ...successDelete,
        deletedOperationsCount: 2,
      },
      onDeleteClient: () => {
        deleteCalled = true;
      },
    });

    expect(promptMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'confirmDeletion', type: 'confirm' }));
    expect(deleteCalled).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Deleted 2 related persisted operation(s).'));
  });

  test('stops when deletion is not confirmed', async () => {
    let deleteCalled = false;
    promptMock.mockResolvedValue({ confirmDeletion: false });

    await runDelete({
      previewResponse: {
        ...successPreview,
        persistedOperationsCount: 1,
      },
      deleteResponse: successDelete,
      onDeleteClient: () => {
        deleteCalled = true;
      },
    });

    expect(deleteCalled).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  test('force skips confirmation', async () => {
    let deleteCalled = false;

    await runDelete({
      previewResponse: {
        ...successPreview,
        persistedOperationsCount: 1,
      },
      deleteResponse: successDelete,
      args: ['--force'],
      onDeleteClient: () => {
        deleteCalled = true;
      },
    });

    expect(promptMock).not.toHaveBeenCalled();
    expect(deleteCalled).toBe(true);
  });

  test('fails on preview rpc error', async () => {
    await expect(
      runDelete({
        previewResponse: {
          response: { code: EnumStatusCode.ERR_NOT_FOUND, details: 'not found' },
          persistedOperationsCount: 0,
        },
        deleteResponse: successDelete,
      }),
    ).rejects.toThrow();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    expect(stderrSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalled();
  });

  test('fails on delete rpc error', async () => {
    await expect(
      runDelete({
        previewResponse: successPreview,
        deleteResponse: {
          response: { code: EnumStatusCode.ERR, details: 'boom' },
          deletedOperationsCount: 0,
          deletedOperations: [],
        },
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
  const promptMock = vi.mocked(inquirer.prompt);

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    promptMock.mockReset();
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  test('prints delete result as json', async () => {
    await runDelete({
      previewResponse: successPreview,
      deleteResponse: {
        ...successDelete,
        deletedOperationsCount: 1,
        deletedOperations: [{ id: 'op-id', operationId: 'GetUser', operationNames: ['GetUser'] }],
      },
      args: ['--json'],
    });

    expect(getJsonOutput(logSpy)).toEqual({
      status: 'success',
      client: successPreview.client,
      deletedOperationsCount: 1,
      deletedOperations: [{ id: 'op-id', operationId: 'GetUser', operationNames: ['GetUser'] }],
    });
    expect(promptMock).not.toHaveBeenCalled();
  });

  test('prints json error instead of prompting when operations exist without force', async () => {
    let deleteCalled = false;

    await runDelete({
      previewResponse: {
        ...successPreview,
        persistedOperationsCount: 1,
      },
      deleteResponse: successDelete,
      args: ['--json'],
      onDeleteClient: () => {
        deleteCalled = true;
      },
    });

    expect(getJsonOutput(logSpy)).toEqual({
      status: 'error',
      code: EnumStatusCode.ERR,
      message: 'Could not delete client.',
      details: "Client 'web' has 1 persisted operation(s). Use --force to delete it.",
    });
    expect(deleteCalled).toBe(false);
    expect(promptMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('prints preview rpc error as json', async () => {
    await runDelete({
      previewResponse: {
        response: { code: EnumStatusCode.ERR_NOT_FOUND, details: 'not found' },
        persistedOperationsCount: 0,
      },
      deleteResponse: successDelete,
      args: ['--json'],
    });

    expect(getJsonOutput(logSpy)).toEqual({
      status: 'error',
      code: EnumStatusCode.ERR_NOT_FOUND,
      message: 'Could not delete client.',
      details: 'not found',
    });
    expect(process.exitCode).toBe(1);
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
