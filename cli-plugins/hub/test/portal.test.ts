import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import type { TunnelSocket } from '../src/common/portal-tunnel.js';
import { createInterrupt, FakeHub, linkedRepo, runWgc, startFakeHub } from './harness.js';

let hub: FakeHub | undefined;
let local: Server | undefined;
afterEach(async () => {
  await hub?.close();
  hub = undefined;
  await new Promise<void>((resolve) => (local ? local.close(() => resolve()) : resolve()));
  local = undefined;
});

const dashboardUrl = 'https://hub.wundergraph.com/acme/operations/op_portal';

const portal = (status: string) => ({
  portalId: 'portal-1',
  subgraph: 'reviews',
  status,
  upstream: 'tunnel',
  openedBy: 'user-1',
  lastRequestAt: null,
  operationId: 'op_portal',
});

const portalTools = () => ({
  open_portal: () => ({
    structuredContent: {
      portal: portal('connecting'),
      credential: 'hubp_secret',
      tunnelPath: '/portals/portal-1/tunnel',
      connectCommand: 'wgc hub portal open reviews --sandbox sb_3fd1 --port <port>',
      dashboardUrl,
    },
  }),
  close_portal: () => ({ structuredContent: { portal: portal('closed') } }),
});

/** The reviews subgraph on this machine: answers with the query it got. */
const startLocalSubgraph = async (): Promise<string> => {
  local = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: { reviews: [] }, extensions: { received: JSON.parse(body) } }));
    });
  });
  await new Promise<void>((resolve) => local?.listen(0, '127.0.0.1', resolve));
  const { port } = local.address() as AddressInfo;
  return String(port);
};

type Frame = { [key: string]: string | number | Frame };

/** Hub's side of each tunnel wgc opens: records what wgc sends and lets the test answer. */
const createFakeTunnel = (onFrame: (frame: Frame, connection: FakeConnection) => void) => {
  const connections: FakeConnection[] = [];
  const openSocket = (url: string): TunnelSocket => {
    const connection = new FakeConnection(url, onFrame);
    connections.push(connection);
    return connection.socket;
  };
  return { connections, openSocket };
};

class FakeConnection {
  readonly sent: Frame[] = [];
  private messageListeners: Array<(text: string) => void> = [];
  private closeListeners: Array<() => void> = [];
  private closed = false;
  readonly socket: TunnelSocket;

  constructor(
    readonly url: string,
    onFrame: (frame: Frame, connection: FakeConnection) => void,
  ) {
    this.socket = {
      send: (text) => {
        const frame = JSON.parse(text) as Frame;
        this.sent.push(frame);
        onFrame(frame, this);
      },
      close: () => this.drop(),
      onOpen: (listener) => setImmediate(listener),
      onMessage: (listener) => this.messageListeners.push(listener),
      onClose: (listener) => this.closeListeners.push(listener),
    };
  }

  /** Sends a frame from Hub to wgc. */
  push(frame: Frame): void {
    setImmediate(() => {
      for (const listener of this.messageListeners) {
        listener(JSON.stringify(frame));
      }
    });
  }

  /** The connection goes away, as when Hub restarts or the network drops. */
  drop(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    setImmediate(() => {
      for (const listener of this.closeListeners) {
        listener();
      }
    });
  }
}

const request = { _tag: 'request', id: 'req-1', method: 'POST', path: '/graphql', body: '{"query":"{ reviews }"}' };

describe('wgc hub portal open', () => {
  test('prints the dashboard URL first, relays requests to the local subgraph, and closes the portal on Ctrl-C', async () => {
    hub = await startFakeHub({ tools: portalTools() });
    const port = await startLocalSubgraph();
    const interrupt = createInterrupt();
    const tunnel = createFakeTunnel((frame, connection) => {
      if (frame._tag === 'hello') {
        connection.push({ _tag: 'ready', portalId: 'portal-1', subgraph: 'reviews' });
        connection.push({ ...request, headers: { 'content-type': 'application/json', host: 'portal.hub.internal' } });
      }
      if (frame._tag === 'response') {
        interrupt.press();
      }
    });

    const run = await runWgc(['hub', 'portal', 'open', 'reviews', '--port', port], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
      output: 'text',
      interrupt,
      openSocket: tunnel.openSocket,
    });

    expect(hub.toolCalls()).toEqual([
      { name: 'open_portal', arguments: { sandbox: 'shop/shop-nithin', subgraph: 'reviews' } },
      { name: 'close_portal', arguments: { sandbox: 'shop/shop-nithin', subgraph: 'reviews' } },
    ]);
    expect(tunnel.connections.map((connection) => connection.url)).toEqual([
      `${hub.url.replace('http', 'ws')}/portals/portal-1/tunnel`,
    ]);

    const [hello, response] = tunnel.connections[0].sent;
    expect(hello).toEqual({ _tag: 'hello', credential: 'hubp_secret', client: 'wgc/0.0.0-test', protocol: 1 });
    expect(response).toMatchObject({ _tag: 'response', id: 'req-1', status: 200 });
    expect(JSON.parse(String(response.body))).toEqual({
      data: { reviews: [] },
      extensions: { received: { query: '{ reviews }' } },
    });

    expect(run.stderr.split('\n').slice(0, 5)).toEqual([
      `  ${dashboardUrl}`,
      '',
      `Portal reviews in shop/shop-nithin -> http://localhost:${port}/graphql. Ctrl-C closes it.`,
      `Connected. reviews requests now reach http://localhost:${port}/graphql`,
      '  POST /graphql  200  0ms',
    ]);
    expect(run.exitCode).toBe(130);
    expect(run.stderr).toContain('Closed the portal. shop/shop-nithin serves reviews as before.');
  });

  test('answers with a GraphQL error naming the local URL when nothing runs there', async () => {
    hub = await startFakeHub({ tools: portalTools() });
    const interrupt = createInterrupt();
    const tunnel = createFakeTunnel((frame, connection) => {
      if (frame._tag === 'hello') {
        connection.push({ ...request, headers: {} });
      }
      if (frame._tag === 'response') {
        interrupt.press();
      }
    });

    await runWgc(['hub', 'portal', 'open', 'reviews', '--url', 'http://127.0.0.1:1/graphql', '--json'], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
      interrupt,
      openSocket: tunnel.openSocket,
    });

    const response = tunnel.connections[0].sent[1];
    expect(response).toMatchObject({ _tag: 'response', status: 502 });
    expect(String(response.body)).toContain('Nothing answers on http://127.0.0.1:1/graphql');
  });

  test('reconnects when the connection drops and ends cleanly when the portal closes in Hub', async () => {
    hub = await startFakeHub({ tools: portalTools() });
    const port = await startLocalSubgraph();
    const tunnel = createFakeTunnel((frame, connection) => {
      if (frame._tag !== 'hello') {
        return;
      }
      connection.push({ _tag: 'ready', portalId: 'portal-1', subgraph: 'reviews' });
      if (tunnel.connections.length === 1) {
        connection.drop();
        return;
      }
      connection.push({ _tag: 'closed', reason: 'closed' });
    });

    const run = await runWgc(['hub', 'portal', 'open', 'reviews', '--port', port, '--json'], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
      openSocket: tunnel.openSocket,
    });

    expect(tunnel.connections).toHaveLength(2);
    expect(
      run.stderr
        .split('\n')
        .filter((line) => line.includes('portal_status'))
        .map((line) => JSON.parse(line).status),
    ).toEqual(['connecting', 'connected', 'reconnecting', 'connected']);
    expect(run.exitCode).toBe(0);
    expect(run.json()).toMatchObject({
      ok: true,
      data: { portal: { id: 'portal-1', subgraph: 'reviews', status: 'closed' }, reason: 'closed' },
    });
  });

  test('refuses to start without --port or --url, before calling Hub', async () => {
    const run = await runWgc(['hub', 'portal', 'open', 'reviews', '--json'], { cwd: await linkedRepo() });

    expect(run.exitCode).toBe(2);
    expect(run.json()).toMatchObject({
      ok: false,
      error: { remediation: 'Pass --port <port> for http://localhost:<port>/graphql, or --url <url>.' },
    });
  });
});

describe('wgc hub portal list and close', () => {
  test('lists portals with their status and last request', async () => {
    hub = await startFakeHub({
      tools: {
        list_portals: () => ({
          structuredContent: {
            portals: [{ ...portal('connected'), lastRequestAt: '2026-11-20T11:58:00Z' }, portal('disconnected')],
          },
        }),
      },
    });

    const run = await runWgc(['hub', 'portal', 'list'], { hubUrl: hub.url, cwd: await linkedRepo(), output: 'text' });

    expect(hub.toolCalls()).toEqual([{ name: 'list_portals', arguments: { sandbox: 'shop/shop-nithin' } }]);
    expect(run.stdout).toBe(
      ['SUBGRAPH  STATUS        LAST REQUEST', 'reviews   connected     2m ago', 'reviews   disconnected  -', ''].join(
        '\n',
      ),
    );
  });

  test('closes the portal of a subgraph in a sandbox named on the command line', async () => {
    hub = await startFakeHub({ tools: portalTools() });

    const run = await runWgc(['hub', 'portal', 'close', 'reviews', '--sandbox', 'shop/checkout', '--json'], {
      hubUrl: hub.url,
      cwd: await linkedRepo(),
    });

    expect(hub.toolCalls()).toEqual([
      { name: 'close_portal', arguments: { sandbox: 'shop/checkout', subgraph: 'reviews' } },
    ]);
    expect(run.json()).toMatchObject({ ok: true, data: { portal: { status: 'closed' } } });
  });
});
