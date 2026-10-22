import { createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type GetObjectCommandOutput, S3Client } from '@aws-sdk/client-s3';
import { serve } from '@hono/node-server';
import { cdn } from '@wundergraph/cosmo-cdn';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createS3BlobStorage } from '../src/s3';

const organizationId = 'organizationId';
const federatedGraphId = 'federatedGraphId';
const authJwtSecret = 'hunter2';

// Use enough varied data for gzip to emit a partial response.
const routerConfig = Buffer.from(JSON.stringify({ padding: randomBytes(262_144).toString('hex') }));

interface FakeObject {
  body: Buffer;
  // Number of body bytes to send before dropping the connection.
  truncateAt?: number;
}

function signToken(payload: Record<string, unknown>) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256' })}.${encode(payload)}`;
  return `${unsigned}.${createHmac('sha256', authJwtSecret).update(unsigned).digest('base64url')}`;
}

/**
 * Minimal S3 server: answers GetObject with Content-Length and can drop the
 * connection mid-body, which is what a failing storage backend looks like to the SDK.
 */
function createFakeS3() {
  const objects = new Map<string, FakeObject>();
  const requestedKeys: string[] = [];
  const server = createServer((req, res) => {
    // Without S3_FORCE_PATH_STYLE the SDK addresses the bucket by host (bucket.localhost), so the path is the key.
    const key = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname.slice(1));
    requestedKeys.push(key);
    const object = objects.get(key);
    if (!object) {
      res.writeHead(404, { 'Content-Type': 'application/xml' });
      res.end('<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code></Error>');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': object.body.byteLength,
      'x-amz-meta-signature-sha256': 'signature',
    });
    if (object.truncateAt === undefined) {
      res.end(object.body);
      return;
    }
    res.write(object.body.subarray(0, object.truncateAt), () => res.destroy());
  });
  return { server, objects, requestedKeys };
}

async function listen(server: Server) {
  if (!server.listening) {
    await once(server, 'listening');
  }
  return (server.address() as AddressInfo).port;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

describe('CDN server backed by S3', () => {
  const s3 = createFakeS3();
  let cdnServer: Server;
  let cdnUrl: string;
  const token = signToken({ organization_id: organizationId, federated_graph_id: federatedGraphId });

  beforeAll(async () => {
    s3.server.listen(0, '127.0.0.1');
    const s3Port = await listen(s3.server);

    // Wire the app the same way src/index.ts does.
    const app = new Hono();
    app.use('*', compress());
    cdn(app, {
      authJwtSecret,
      authAdmissionJwtSecret: 'hunter3',
      blobStorage: createS3BlobStorage(`http://test:test@localhost:${s3Port}/bucket`),
    });
    cdnServer = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }) as Server;
    cdnUrl = `http://127.0.0.1:${await listen(cdnServer)}`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await close(cdnServer);
    await close(s3.server);
  });

  beforeEach(() => {
    s3.objects.clear();
    s3.requestedKeys.length = 0;
  });

  describe.each(['identity', 'gzip'])('router config with %s encoding', (encoding) => {
    const key = `${organizationId}/${federatedGraphId}/routerconfigs/latest.json`;

    const fetchRouterConfig = () =>
      fetch(`${cdnUrl}/${organizationId}/${federatedGraphId}/routerconfigs/latest.json`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Accept-Encoding': encoding,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: AbortSignal.timeout(5000),
      });

    test('serves the complete object', async () => {
      s3.objects.set(key, { body: routerConfig });

      const response = await fetchRouterConfig();

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Encoding')).toBe(encoding === 'gzip' ? 'gzip' : null);
      expect(response.headers.get('X-Signature-SHA256')).toBe('signature');
      expect(Buffer.from(await response.arrayBuffer()).equals(routerConfig)).toBe(true);
      expect(s3.requestedKeys).toEqual([key]);
    });

    test('aborts the response when storage drops the connection mid-object', async () => {
      s3.objects.set(key, { body: routerConfig, truncateAt: routerConfig.byteLength / 2 });

      const response = await fetchRouterConfig();

      // Headers are already sent when the storage read fails, so the only way to signal the
      // failure is to abort the response instead of completing a truncated 200.
      expect(response.status).toBe(200);
      await expect(response.arrayBuffer()).rejects.toThrow(/terminated|fetch failed/);
    });

    test('aborts the response when the storage body ends early without an error', async () => {
      s3.objects.set(key, { body: routerConfig });
      // Keep the real SDK request, but end its body cleanly after half the bytes, as a transport that
      // swallows a short read would. Only the Content-Length check can tell this apart from success.
      const send = S3Client.prototype.send;
      vi.spyOn(S3Client.prototype, 'send').mockImplementation(async function (this: S3Client, command: any) {
        const output = (await send.call(this, command)) as GetObjectCommandOutput;
        const body = output.Body!.transformToWebStream();
        let remaining = routerConfig.byteLength / 2;
        output.Body!.transformToWebStream = () =>
          body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                controller.enqueue(chunk.subarray(0, remaining));
                remaining -= Math.min(remaining, chunk.byteLength);
                if (remaining === 0) {
                  controller.terminate();
                }
              },
            }),
          );
        return output;
      });

      const response = await fetchRouterConfig();

      expect(response.status).toBe(200);
      await expect(response.arrayBuffer()).rejects.toThrow(/terminated|fetch failed/);
    });

    test('returns 404 when the object does not exist', async () => {
      const response = await fetchRouterConfig();

      expect(response.status).toBe(404);
    });
  });
});
