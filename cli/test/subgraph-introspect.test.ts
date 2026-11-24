import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SubgraphCommands from '../src/commands/subgraph/index.js';
import { Client } from '../src/core/client/client.js';

describe('subgraph introspect', () => {
  let server: Server;
  let url: string;

  beforeEach(async () => {
    server = createServer((_, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: { _service: { sdl: 'type Query {\n  products: [String!]!\n}' } } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('prints only the SDL to stdout, without a login', async () => {
    vi.stubEnv('COSMO_API_KEY', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const program = new Command();
    program.addCommand(SubgraphCommands({ client: {} as Client }));

    await program.parseAsync(['subgraph', 'introspect', '--routing-url', url], { from: 'user' });

    expect(log.mock.calls).toEqual([['type Query {\n  products: [String!]!\n}']]);
  });
});
