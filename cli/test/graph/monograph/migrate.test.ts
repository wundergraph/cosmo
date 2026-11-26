import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { createClient, createRouterTransport } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import inquirer from 'inquirer';
import MigrateMonographCommand from '../../../src/commands/graph/monograph/commands/migrate.js';
import { Client } from '../../../src/core/client/client.js';

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}));

const setStdinIsTTY = (value: boolean) => {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
};

const runMigrate = async (
  args: string[],
  onMigrate: (namespace: string) => void,
  code: EnumStatusCode = EnumStatusCode.OK,
): Promise<void> => {
  const client: Client = {
    platform: createClient(
      PlatformService,
      createRouterTransport(({ service }) => {
        service(PlatformService, {
          migrateMonograph: (request) => {
            onMigrate(request.namespace);
            return { response: { code, details: code === EnumStatusCode.OK ? '' : 'not a monograph' } };
          },
        });
      }),
    ),
  };
  const program = new Command();
  program.exitOverride();
  program.addCommand(MigrateMonographCommand({ client }));
  await program.parseAsync(['migrate', 'storefront', ...args], { from: 'user' });
};

describe('monograph migrate', () => {
  let stderrSpy: MockInstance<typeof process.stderr.write>;
  const promptMock = vi.mocked(inquirer.prompt);

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    promptMock.mockReset();
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  test('refuses without a terminal and names --force', async () => {
    setStdinIsTTY(false);
    const migrated: string[] = [];

    await expect(runMigrate(['--namespace', 'legacy'], (namespace) => migrated.push(namespace))).rejects.toThrow(
      'process.exit',
    );

    expect(promptMock).not.toHaveBeenCalled();
    expect(migrated).toEqual([]);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Migrating the monograph "storefront" is irreversible and needs confirmation. Re-run with --force to migrate it without a prompt.',
      ),
    );
  });

  test('migrates without a terminal or a prompt when --force is given', async () => {
    setStdinIsTTY(false);
    const migrated: string[] = [];

    await runMigrate(['--namespace', 'legacy', '--force'], (namespace) => migrated.push(namespace));

    expect(promptMock).not.toHaveBeenCalled();
    expect(migrated).toEqual(['legacy']);
    expect(process.exitCode).toBeUndefined();
  });

  test('asks in a terminal and stops when the migration is not confirmed', async () => {
    setStdinIsTTY(true);
    promptMock.mockResolvedValue({ confirmMigration: false });
    const migrated: string[] = [];

    await runMigrate(['--namespace', 'legacy'], (namespace) => migrated.push(namespace));

    expect(promptMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'confirmMigration', type: 'confirm' }));
    expect(migrated).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  test('exits 1 when the control plane does not migrate it', async () => {
    setStdinIsTTY(false);

    await runMigrate(['--force'], () => {}, EnumStatusCode.ERR_NOT_FOUND);

    expect(process.exitCode).toBe(1);
  });
});
