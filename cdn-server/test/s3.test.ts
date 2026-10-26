import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { S3Client } from '@aws-sdk/client-s3';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createS3BlobStorage } from '../src/s3';

const storage = createS3BlobStorage('http://test:test@localhost:9000/bucket');

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(['identity', 'gzip'])('S3 downloads over HTTP with %s encoding', (encoding) => {
  // Use enough varied data for gzip to emit a partial response.
  const data = Buffer.from(JSON.stringify({ padding: randomBytes(262_144).toString('hex') }));

  async function download(body: Buffer, upstreamError?: Error) {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
        controller.enqueue(upstreamError ? body.subarray(0, body.byteLength / 2) : body);
        if (!upstreamError) {
          controller.close();
        }
      },
    });
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(() =>
      Promise.resolve({
        $metadata: { httpStatusCode: 200 },
        ContentLength: body.byteLength,
        Body: { transformToWebStream: () => stream },
      }),
    );

    const app = new Hono();
    app.use('*', compress());
    app.get('/', async (c) => {
      const object = await storage.getObject({ context: c, key: 'config.json' });
      c.header('Content-Type', 'application/json');
      return c.body(object.stream);
    });
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }) as Server;
    try {
      if (!server.listening) {
        await once(server, 'listening');
      }
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, {
        headers: { 'Accept-Encoding': encoding },
        signal: AbortSignal.timeout(5000),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Encoding')).toBe(encoding === 'gzip' ? 'gzip' : null);
      // Fail only after the HTTP response has started.
      if (upstreamError) {
        source.error(upstreamError);
      }
      return Buffer.from(await response.arrayBuffer());
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  }

  test('delivers complete objects unchanged', async () => {
    expect((await download(data)).equals(data)).toBe(true);
  });

  test('delivers empty objects', async () => {
    await expect(download(Buffer.alloc(0))).resolves.toEqual(Buffer.alloc(0));
  });

  test('rejects incomplete downloads', async () => {
    await expect(download(data, new Error('upstream read failed'))).rejects.toThrow(/terminated|fetch failed/);
  });
});
