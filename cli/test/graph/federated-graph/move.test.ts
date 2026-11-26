import { createClient, createRouterTransport } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Command } from 'commander';
import { afterEach, describe, expect, test, vi } from 'vitest';
import MoveCommand from '../../../src/commands/graph/federated-graph/commands/move.js';
import { Client } from '../../../src/core/client/client.js';

const spinnerTexts = vi.hoisted((): string[] => []);

vi.mock('ora', () => {
  return {
    default: (text: string) => {
      spinnerTexts.push(text);
      const spinner = {
        start: () => spinner,
        succeed: () => spinner,
        warn: () => spinner,
        fail: () => spinner,
      };
      return spinner;
    },
  };
});

describe('federated-graph move command', () => {
  afterEach(() => {
    spinnerTexts.length = 0;
    vi.restoreAllMocks();
  });

  test('the spinner names the federated graph being moved', async () => {
    const client: Client = {
      platform: createClient(
        PlatformService,
        createRouterTransport(({ service }) => {
          service(PlatformService, {
            moveFederatedGraph: () => ({ response: { code: EnumStatusCode.OK } }),
          });
        }),
      ),
    };

    const program = new Command();
    program.addCommand(MoveCommand({ client }));
    await program.parseAsync(['move', 'mygraph', '--namespace', 'legacy', '--to', 'default'], { from: 'user' });

    expect(spinnerTexts).toEqual(['Federated graph is being moved...']);
  });
});
