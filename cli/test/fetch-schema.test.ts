import { rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test, expect } from 'vitest';
import { Command } from 'commander';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Client } from '../src/core/client/client.js';
import FetchSchemaCommand from '../src/commands/graph/common/fetch-schema.js';

const routerSdl = 'type User {\n  id: String @authenticated\n}';
const clientSdl = 'type User {\n  id: String\n}';

export const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {
      getFederatedGraphSDLByName: (ctx) => {
        return {
          response: {
            code: EnumStatusCode.OK,
          },
          sdl: routerSdl,
          versionId: '1234',
          clientSchema: clientSdl,
        };
      },
    });
  });

describe('Fetch schema', () => {
  test('should return router schema', async () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
      // @ts-ignore
      node: null,
    };

    const program = new Command();
    program.addCommand(
      FetchSchemaCommand({
        client,
      }),
    );

    const tmp = join(tmpdir(), `router-schema-${Date.now()}.graphql`);
    try {
      const command = await program.parseAsync(
        ['fetch-schema', 'mygraph', '-o', tmp],
        {
          from: 'user',
        }
      );

      const content = readFileSync(tmp, 'utf8');
      expect(content).toBe(routerSdl);
    } finally {
      rmSync(tmp);
    }
  });

  test('should return client schema', async () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
    };

    const program = new Command();
    program.addCommand(
      FetchSchemaCommand({
        client,
      }),
    );

    const tmp = join(tmpdir(), `client-schema-${Date.now()}.graphql`);
    try {
      const command = await program.parseAsync(
        ['fetch-schema', 'mygraph', '-o', tmp, '--client-schema'],
        {
          from: 'user',
        }
      );

      const content = readFileSync(tmp, 'utf8');
      expect(content).toBe(clientSdl);
    } finally {
      rmSync(tmp);
    }
  });
});