import { describe, test } from 'vitest';
import { Command } from 'commander';
import { createPromiseClient, createRouterTransport } from '@connectrpc/connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { Client } from '../src/core/client/client.js';
import IntrospectOpenApi from '../src/commands/introspect/commands/openapi.js';

export const mockPlatformTransport = () =>
  createRouterTransport(({ service }) => {
    service(PlatformService, {});
  });

describe('Introspect Command', () => {
  test('Introspect OpenApi', () => {
    const client: Client = {
      platform: createPromiseClient(PlatformService, mockPlatformTransport()),
      node: null,
    };

    const program = new Command();

    program.addCommand(IntrospectOpenApi({ client }));
    const command = program.parse(['introspect', 'openapi', 'test/fixtures/openapi/Looker.4.0.oas.json'], {
      from: 'user',
    });

    console.log(command);
  });
});
