import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, test, expect } from 'vitest';
import { Context, Hono } from 'hono';
import { BlobStorage, BlobNotFoundError, cdn, BlobObject, signatureSha256Header } from '../src';

const secretKey = 'hunter2';
const secretAdmissionKey = 'hunter3';

const generateToken = async (
  organizationId: string,
  federatedGraphId: string | undefined,
  secret: string,
  features?: string[],
) => {
  const secretKey = new TextEncoder().encode(secret);
  const payload: Record<string, unknown> = {
    organization_id: organizationId,
    federated_graph_id: federatedGraphId,
  };
  if (features !== undefined) {
    payload.features = features;
  }
  return await new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).sign(secretKey);
};

class InMemoryBlobStorage implements BlobStorage {
  objects: Map<string, { buffer: Buffer; metadata?: BlobObject['metadata'] }> = new Map();
  getObject({ key }: { context: Context; key: string; cacheControl?: string }): Promise<BlobObject> {
    const obj = this.objects.get(key);
    if (!obj) {
      throw new BlobNotFoundError(`Object with key ${key} not found`);
    }
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(obj.buffer);
        controller.close();
      },
    });
    return Promise.resolve({ stream, metadata: obj.metadata });
  }

  headObject({ key, version }: { key: string; version: string }): Promise<boolean> {
    const obj = this.objects.get(key);
    if (!obj) {
      return Promise.reject(new BlobNotFoundError(`Object with key ${key} not found`));
    }
    if (obj.metadata?.version === version) {
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }
}

describe('CDN handlers', () => {
  describe('Test JWT authentication with persistent operation', async () => {
    const federatedGraphId = 'federatedGraphId';
    const organizationId = 'organizationId';
    const token = await generateToken(organizationId, federatedGraphId, secretKey);
    const blobStorage = new InMemoryBlobStorage();

    const requestPath = `/${organizationId}/${federatedGraphId}/operations/clientName/operation.json`;

    const app = new Hono();

    cdn(app, {
      authJwtSecret: secretKey,
      authAdmissionJwtSecret: secretAdmissionKey,
      blobStorage,
    });

    test('it returns a 401 if no Authorization header is provided', async () => {
      const res = await app.request(requestPath, {
        method: 'GET',
      });
      expect(res.status).toBe(401);
    });

    test('it returns a 403 if an invalid Authorization header is provided', async () => {
      const res = await app.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token.slice(0, -1)}}`,
        },
      });
      expect(res.status).toBe(401);
    });

    test('it authenticates the request when a valid Authorization header is provided', async () => {
      const res = await app.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(404);
    });

    test('it returns a 400 if the graph or organization ids does not match with the JWT payload', async () => {
      const res = await app.request(`/foo/bar/operations/clientName/operation.json`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(400);
    });

    test('it returns a 401 if the token has expired', async () => {
      const token = await new SignJWT({
        organization_id: organizationId,
        federated_graph_id: federatedGraphId,
        exp: Math.floor(Date.now() / 1000) - 60,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(new TextEncoder().encode(secretKey));
      const res = await app.request(`/foo/bar/operations/clientName/operation.json`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Test JWT authentication with ready router configs', async () => {
    const federatedGraphId = 'federatedGraphId';
    const organizationId = 'organizationId';
    const token = await generateToken(organizationId, federatedGraphId, secretKey);
    const blobStorage = new InMemoryBlobStorage();

    const requestPath = `/${organizationId}/${federatedGraphId}/routerconfigs/latest.json`;

    const app = new Hono();

    cdn(app, {
      authJwtSecret: secretKey,
      authAdmissionJwtSecret: secretAdmissionKey,
      blobStorage,
    });

    test('it returns a 401 if no Authorization header is provided', async () => {
      const res = await app.request(requestPath, {
        method: 'GET',
      });
      expect(res.status).toBe(401);
    });

    test('it returns a 401 if an invalid Authorization header is provided', async () => {
      const res = await app.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token.slice(0, -1)}}`,
        },
      });
      expect(res.status).toBe(401);
    });

    test('it returns a 400 if the graph or organization ids does not match with the JWT payload', async () => {
      const res = await app.request(`/foo/bar/operations/routerconfigs/latest.json`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(400);
    });

    test('it returns a 401 if the token has expired', async () => {
      const token = await new SignJWT({
        organization_id: organizationId,
        federated_graph_id: federatedGraphId,
        exp: Math.floor(Date.now() / 1000) - 60,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(new TextEncoder().encode(secretKey));
      const res = await app.request(`/foo/bar/operations/routerconfigs/latest.json`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Test JWT authentication with draft router configs', async () => {
    const federatedGraphId = 'federatedGraphId';
    const organizationId = 'organizationId';
    const token = await generateToken(organizationId, federatedGraphId, secretKey);
    const blobStorage = new InMemoryBlobStorage();

    const requestPath = `/${organizationId}/${federatedGraphId}/routerconfigs/draft.json`;

    const app = new Hono();

    cdn(app, {
      authJwtSecret: secretKey,
      authAdmissionJwtSecret: secretAdmissionKey,
      blobStorage,
    });

    test('it returns a 401 if no Authorization header is provided', async () => {
      const res = await app.request(requestPath, {
        method: 'GET',
      });
      expect(res.status).toBe(401);
    });

    test('it returns a 401 if an invalid Authorization header is provided', async () => {
      const res = await app.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token.slice(0, -1)}}`,
        },
      });
      expect(res.status).toBe(401);
    });

    test('it returns a 400 if the graph or organization ids does not match with the JWT payload', async () => {
      const res = await app.request(`/foo/bar/operations/routerconfigs/draft.json`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(400);
    });

    test('it returns a 401 if the token has expired', async () => {
      const token = await new SignJWT({
        organization_id: organizationId,
        federated_graph_id: federatedGraphId,
        exp: Math.floor(Date.now() / 1000) - 60,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(new TextEncoder().encode(secretKey));
      const res = await app.request(`/foo/bar/operations/routerconfigs/draft.json`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Test persisted operations handler', async () => {
    const federatedGraphId = 'federatedGraphId';
    const organizationId = 'organizationId';
    const token = await generateToken(organizationId, federatedGraphId, secretKey);
    const blobStorage = new InMemoryBlobStorage();
    const clientName = 'clientName';
    const operationHash = 'operationHash';
    const operationContents = JSON.stringify({ version: 1, body: 'query { hello }' });

    blobStorage.objects.set(`${organizationId}/${federatedGraphId}/operations/${clientName}/${operationHash}.json`, {
      buffer: Buffer.from(operationContents),
    });

    const app = new Hono();

    cdn(app, {
      authJwtSecret: secretKey,
      authAdmissionJwtSecret: secretAdmissionKey,
      blobStorage,
    });

    test('it returns a persisted operation', async () => {
      const res = await app.request(
        `/${organizationId}/${federatedGraphId}/operations/${clientName}/${operationHash}.json`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(operationContents);
    });

    test('it returns a 404 if the persisted operation does not exist', async () => {
      const res = await app.request(
        `/${organizationId}/${federatedGraphId}/operations/${clientName}/does_not_exist.json`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      expect(res.status).toBe(404);
    });
  });

  describe('Test ready router config handler', async () => {
    const federatedGraphId = 'federatedGraphId';
    const organizationId = 'organizationId';
    const token = await generateToken(organizationId, federatedGraphId, secretKey);
    const blobStorage = new InMemoryBlobStorage();
    const routerConfig = JSON.stringify({
      engineConfig: {},
    });

    blobStorage.objects.set(`${organizationId}/${federatedGraphId}/routerconfigs/latest.json`, {
      buffer: Buffer.from(routerConfig),
      metadata: {
        version: '1',
        'signature-sha256': 'signature',
      },
    });

    const app = new Hono();

    cdn(app, {
      authJwtSecret: secretKey,
      authAdmissionJwtSecret: secretAdmissionKey,
      blobStorage,
    });

    test('it returns a router config', async () => {
      const res = await app.request(`/${organizationId}/${federatedGraphId}/routerconfigs/latest.json`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ version: '' }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get(signatureSha256Header)).toBe('signature');
      expect(await res.text()).toBe(routerConfig);
    });

    test('it returns a 404 if the router config does not exist', async () => {
      const res = await app.request(`/${organizationId}/${federatedGraphId}/routerconfigs/does_not_exist.json`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ version: '' }),
      });
      expect(res.status).toBe(404);
    });

    test('it returns a 304 if the version is the same as before', async () => {
      const res = await app.request(`/${organizationId}/${federatedGraphId}/routerconfigs/latest.json`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ version: '1' }),
      });
      expect(res.status).toBe(304);
      expect(res.headers.get(signatureSha256Header)).toBeFalsy();
    });
  });

  describe('Test versioned router config handler', async () => {
    const federatedGraphId = 'federatedGraphId';
    const organizationId = 'organizationId';
    const token = await generateToken(organizationId, federatedGraphId, secretKey);
    const blobStorage = new InMemoryBlobStorage();
    const routerConfig = JSON.stringify({
      engineConfig: {},
    });

    blobStorage.objects.set(`${organizationId}/${federatedGraphId}/routerconfigs/v2/latest.json`, {
      buffer: Buffer.from(routerConfig),
      metadata: {
        version: '1',
        'signature-sha256': 'signature',
      },
    });

    const app = new Hono();

    cdn(app, {
      authJwtSecret: secretKey,
      authAdmissionJwtSecret: secretAdmissionKey,
      blobStorage,
    });

    test('that an error is thrown if an invalid router config path is requested', async () => {
      const res = await app.request(`/${organizationId}/${federatedGraphId}/routerconfigs/v2/latest.json`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ version: '' }),
      });
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('Invalid router compatibility version "v2".');
      expect(res.headers.get(signatureSha256Header)).toBeFalsy();
    });

    test('it returns a 404 if the router config does not exist', async () => {
      const res = await app.request(`/${organizationId}/${federatedGraphId}/routerconfigs/v3/does_not_exist.json`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ version: '' }),
      });
      expect(res.status).toBe(404);
      expect(res.headers.get(signatureSha256Header)).toBeFalsy();
    });

    test('than an error is thrown if the version is unchanged but an invalid router config path is requested', async () => {
      const res = await app.request(`/${organizationId}/${federatedGraphId}/routerconfigs/v2/latest.json`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ version: '1' }),
      });
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('Invalid router compatibility version "v2".');
      expect(res.headers.get(signatureSha256Header)).toBeFalsy();
    });
  });

  describe('Test draft router config handler', async () => {
    const federatedGraphId = 'federatedGraphId';
    const organizationId = 'organizationId';
    const token = await generateToken(organizationId, federatedGraphId, secretAdmissionKey);
    const blobStorage = new InMemoryBlobStorage();
    const routerConfig = JSON.stringify({
      engineConfig: {},
    });

    blobStorage.objects.set(`${organizationId}/${federatedGraphId}/routerconfigs/draft.json`, {
      buffer: Buffer.from(routerConfig),
      metadata: {
        version: '1',
        'signature-sha256': '',
      },
    });

    const app = new Hono();

    cdn(app, {
      authJwtSecret: secretKey,
      authAdmissionJwtSecret: secretAdmissionKey,
      blobStorage,
    });

    test('it returns a router config', async () => {
      const res = await app.request(`/${organizationId}/${federatedGraphId}/routerconfigs/draft.json?token=${token}`, {
        method: 'GET',
      });
      expect(res.status).toBe(200);
      expect(res.headers.get(signatureSha256Header)).toBeFalsy();
      expect(res.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate');
      expect(await res.text()).toBe(routerConfig);
    });

    test('it returns a 404 if the router config does not exist', async () => {
      const res = await app.request(
        `/${organizationId}/${federatedGraphId}/routerconfigs/draft-not-found.json?token=${token}`,
        {
          method: 'GET',
        },
      );
      expect(res.status).toBe(404);
    });
  });

  describe('Test cache warmer operations handler', async () => {
    const federatedGraphId = 'federatedGraphId';
    const organizationId = 'organizationId';
    const token = await generateToken(organizationId, federatedGraphId, secretKey);
    const blobStorage = new InMemoryBlobStorage();
    const requestPath = `${organizationId}/${federatedGraphId}/cache_warmup/operations.json`;

    const app = new Hono();

    cdn(app, {
      authJwtSecret: secretKey,
      authAdmissionJwtSecret: secretAdmissionKey,
      blobStorage,
    });

    test('it returns a 401 if no Authorization header is provided', async () => {
      const res = await app.request(requestPath, {
        method: 'GET',
      });
      expect(res.status).toBe(401);
    });

    test('it returns a 401 if an invalid Authorization header is provided', async () => {
      const res = await app.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token.slice(0, -1)}}`,
        },
      });
      expect(res.status).toBe(401);
    });

    test('it returns a 400 if the graph or organization ids does not match with the JWT payload', async () => {
      const res = await app.request(`/foo/bar/operations/cache_warmup/operations.json`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(400);
    });

    test('it returns a 401 if the token has expired', async () => {
      const token = await new SignJWT({
        organization_id: organizationId,
        federated_graph_id: federatedGraphId,
        exp: Math.floor(Date.now() / 1000) - 60,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(new TextEncoder().encode(secretKey));
      const res = await app.request(`/foo/bar/cache_warmup/operations.json`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(401);
    });

    test('it returns the cache warmer operations', async () => {
      const operationContents = JSON.stringify({
        operations: [
          {
            request: {
              operationName: 'AB',
              query: 'query AB($a: Int!){employeeAsList(id: $a){tag id derivedMood products}}',
            },
            client: { name: 'unknown', version: 'missing' },
          },
        ],
      });

      blobStorage.objects.set(requestPath, {
        buffer: Buffer.from(operationContents),
      });

      const res = await app.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(operationContents);
    });

    test('it returns a 404 if the persisted operation does not exist', async () => {
      const res = await app.request(`${organizationId}/${federatedGraphId}/cache_warmup/does_not_exist.json`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('Test persisted operations manifest handler', async () => {
    const federatedGraphId = 'federatedGraphId';
    const organizationId = 'organizationId';
    const token = await generateToken(organizationId, federatedGraphId, secretKey);
    const blobStorage = new InMemoryBlobStorage();
    const requestPath = `/${organizationId}/${federatedGraphId}/operations/manifest.json`;

    const app = new Hono();

    cdn(app, {
      authJwtSecret: secretKey,
      authAdmissionJwtSecret: secretAdmissionKey,
      blobStorage,
    });

    test('it returns a 401 if no Authorization header is provided', async () => {
      const res = await app.request(requestPath, {
        method: 'GET',
      });
      expect(res.status).toBe(401);
    });

    test('it returns a 401 if an invalid Authorization header is provided', async () => {
      const res = await app.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token.slice(0, -1)}}`,
        },
      });
      expect(res.status).toBe(401);
    });

    test('it returns a 400 if the graph or organization ids does not match with the JWT payload', async () => {
      const res = await app.request(`/foo/bar/operations/manifest.json`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(400);
    });

    test('it returns a 401 if the token has expired', async () => {
      const token = await new SignJWT({
        organization_id: organizationId,
        federated_graph_id: federatedGraphId,
        exp: Math.floor(Date.now() / 1000) - 60,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(new TextEncoder().encode(secretKey));
      const res = await app.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(401);
    });

    test('it returns the manifest with ETag on first request', async () => {
      const manifestContents = JSON.stringify({
        version: 1,
        revision: 'abc123',
        generatedAt: '2025-01-01T00:00:00.000Z',
        operations: {
          sha256hash1: 'query { hello }',
        },
      });

      blobStorage.objects.set(`${organizationId}/${federatedGraphId}/operations/manifest.json`, {
        buffer: Buffer.from(manifestContents),
        metadata: { version: 'abc123' },
      });

      const res = await app.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/json; charset=UTF-8');
      expect(res.headers.get('ETag')).toBe('"abc123"');
      expect(await res.text()).toBe(manifestContents);
    });

    test('it returns 304 with ETag when If-None-Match matches', async () => {
      blobStorage.objects.set(`${organizationId}/${federatedGraphId}/operations/manifest.json`, {
        buffer: Buffer.from(JSON.stringify({ version: 1, revision: 'abc123', operations: {} })),
        metadata: { version: 'abc123' },
      });

      const res = await app.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'If-None-Match': '"abc123"',
        },
      });
      expect(res.status).toBe(304);
      expect(res.headers.get('ETag')).toBe('"abc123"');
    });

    test('it returns 200 with new ETag when If-None-Match does not match', async () => {
      const manifestContents = JSON.stringify({
        version: 1,
        revision: 'def456',
        generatedAt: '2025-01-01T00:00:00.000Z',
        operations: {
          sha256hash1: 'query { hello }',
        },
      });

      blobStorage.objects.set(`${organizationId}/${federatedGraphId}/operations/manifest.json`, {
        buffer: Buffer.from(manifestContents),
        metadata: { version: 'def456' },
      });

      const res = await app.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'If-None-Match': '"old-revision"',
        },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('ETag')).toBe('"def456"');
      expect(await res.text()).toBe(manifestContents);
    });

    test('ETag round-trip: fetch returns ETag, re-fetch with that ETag returns 304', async () => {
      const manifestContents = JSON.stringify({
        version: 1,
        revision: 'rev-round-trip',
        generatedAt: '2025-01-01T00:00:00.000Z',
        operations: { hash1: 'query { hello }' },
      });

      blobStorage.objects.set(`${organizationId}/${federatedGraphId}/operations/manifest.json`, {
        buffer: Buffer.from(manifestContents),
        metadata: { version: 'rev-round-trip' },
      });

      // First request: no ETag, should get 200 with ETag
      const res1 = await app.request(requestPath, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res1.status).toBe(200);
      const etag = res1.headers.get('ETag');
      expect(etag).toBe('"rev-round-trip"');
      expect(await res1.text()).toBe(manifestContents);

      // Second request: send ETag back as If-None-Match, should get 304
      const res2 = await app.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'If-None-Match': etag!,
        },
      });
      expect(res2.status).toBe(304);
      expect(res2.headers.get('ETag')).toBe(etag);
    });

    test('it returns a 404 if the manifest does not exist', async () => {
      const otherBlobStorage = new InMemoryBlobStorage();
      const otherApp = new Hono();

      cdn(otherApp, {
        authJwtSecret: secretKey,
        authAdmissionJwtSecret: secretAdmissionKey,
        blobStorage: otherBlobStorage,
      });

      const res = await otherApp.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(404);
    });

    test('it does not conflict with the individual persisted operations route', async () => {
      const operationContents = JSON.stringify({ version: 1, body: 'query { hello }' });
      blobStorage.objects.set(`${organizationId}/${federatedGraphId}/operations/clientName/operation.json`, {
        buffer: Buffer.from(operationContents),
      });

      const res = await app.request(`/${organizationId}/${federatedGraphId}/operations/clientName/operation.json`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(operationContents);
    });
  });

  describe('schema check extensions handler', async () => {
    const organizationId = 'organizationId';
    const checkId = randomUUID();
    const token = await generateToken(organizationId, undefined, secretKey);
    const blobStorage = new InMemoryBlobStorage();
    const requestPath = `${organizationId}/subgraph_checks/${checkId}.json`;

    const app = new Hono();

    cdn(app, {
      authJwtSecret: secretKey,
      authAdmissionJwtSecret: secretAdmissionKey,
      blobStorage,
    });

    test('it returns a 401 if no Authorization header is provided', async () => {
      const res = await app.request(requestPath, {
        method: 'GET',
      });
      expect(res.status).toBe(401);
    });

    test('it returns a 401 if an invalid Authorization header is provided', async () => {
      const res = await app.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token.slice(0, -1)}}`,
        },
      });
      expect(res.status).toBe(401);
    });

    test('it returns a 400 if the organization id does not match with the JWT payload', async () => {
      const res = await app.request(`/foo/subgraph_checks/operations.json`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(400);
    });

    test('it returns a 401 if the token has expired', async () => {
      const token = await new SignJWT({
        organization_id: organizationId,
        federated_graph_id: undefined,
        exp: Math.floor(Date.now() / 1000) - 60,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .sign(new TextEncoder().encode(secretKey));
      const res = await app.request(`/foo/subgraph_checks/operations.json`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(401);
    });

    test('it returns the schema check extension file content', async () => {
      const operationContents = JSON.stringify({
        subgraphs: [{ id: '123', name: 'test' }],
        compositions: [],
      });

      blobStorage.objects.set(requestPath, {
        buffer: Buffer.from(operationContents),
      });

      const res = await app.request(requestPath, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(operationContents);
    });

    test('it returns a 404 if the schema check extension does not exist', async () => {
      const res = await app.request(`${organizationId}/subgraph_checks/does_not_exist.json`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('Test manifest endpoints (split-config-loading)', async () => {
    const federatedGraphId = 'federatedGraphId';
    const organizationId = 'organizationId';
    const tokenWithFeature = await generateToken(organizationId, federatedGraphId, secretKey, ['split-config-loading']);
    const tokenNoFeature = await generateToken(organizationId, federatedGraphId, secretKey);
    const tokenWrongFeature = await generateToken(organizationId, federatedGraphId, secretKey, ['other-feature']);
    const blobStorage = new InMemoryBlobStorage();

    const mapperContents = JSON.stringify({ graphConfigs: { '': 'hash-base' } });
    const latestContents = JSON.stringify({ version: 'v1', engineConfig: {} });
    const featureFlagContents = JSON.stringify({ version: 'v1', engineConfig: { featureFlag: true } });

    blobStorage.objects.set(`${organizationId}/${federatedGraphId}/manifest/mapper.json`, {
      buffer: Buffer.from(mapperContents),
      metadata: { version: 'v1', 'signature-sha256': 'sig-mapper' },
    });

    blobStorage.objects.set(`${organizationId}/${federatedGraphId}/manifest/latest.json`, {
      buffer: Buffer.from(latestContents),
      metadata: { version: 'v1' },
    });

    blobStorage.objects.set(`${organizationId}/${federatedGraphId}/manifest/feature-flags/my-flag.json`, {
      buffer: Buffer.from(featureFlagContents),
      metadata: { version: 'v1' },
    });

    const app = new Hono();

    cdn(app, {
      authJwtSecret: secretKey,
      authAdmissionJwtSecret: secretAdmissionKey,
      blobStorage,
    });

    describe('feature gate authorization', () => {
      test('returns 403 when features claim is missing from JWT', async () => {
        const res = await app.request(`/${organizationId}/${federatedGraphId}/manifest/mapper.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenNoFeature}` },
          body: JSON.stringify({ version: '' }),
        });
        expect(res.status).toBe(403);
      });

      test('returns 403 when features claim does not include split-config-loading', async () => {
        const res = await app.request(`/${organizationId}/${federatedGraphId}/manifest/mapper.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenWrongFeature}` },
          body: JSON.stringify({ version: '' }),
        });
        expect(res.status).toBe(403);
      });

      test('returns 403 for latest.json without feature', async () => {
        const res = await app.request(`/${organizationId}/${federatedGraphId}/manifest/latest.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenNoFeature}` },
          body: JSON.stringify({ version: '' }),
        });
        expect(res.status).toBe(403);
      });

      test('returns 403 for feature-flags without feature', async () => {
        const res = await app.request(`/${organizationId}/${federatedGraphId}/manifest/feature-flags/my-flag.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenNoFeature}` },
          body: JSON.stringify({ version: '' }),
        });
        expect(res.status).toBe(403);
      });
    });

    describe('JWT authentication', () => {
      test('returns 401 with no token', async () => {
        const res = await app.request(`/${organizationId}/${federatedGraphId}/manifest/mapper.json`, {
          method: 'POST',
        });
        expect(res.status).toBe(401);
      });

      test('returns 401 with invalid token', async () => {
        const res = await app.request(`/${organizationId}/${federatedGraphId}/manifest/mapper.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenWithFeature.slice(0, -1)}}` },
          body: JSON.stringify({ version: '' }),
        });
        expect(res.status).toBe(401);
      });

      test('returns 401 with expired token', async () => {
        const expiredToken = await new SignJWT({
          organization_id: organizationId,
          federated_graph_id: federatedGraphId,
          features: ['split-config-loading'],
          exp: Math.floor(Date.now() / 1000) - 60,
        })
          .setProtectedHeader({ alg: 'HS256' })
          .sign(new TextEncoder().encode(secretKey));
        const res = await app.request(`/${organizationId}/${federatedGraphId}/manifest/mapper.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${expiredToken}` },
          body: JSON.stringify({ version: '' }),
        });
        expect(res.status).toBe(401);
      });
    });

    describe('mapper.json', () => {
      test('returns mapper blob content with correct headers', async () => {
        const res = await app.request(`/${organizationId}/${federatedGraphId}/manifest/mapper.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenWithFeature}` },
          body: JSON.stringify({ version: '' }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/json; charset=UTF-8');
        expect(res.headers.get(signatureSha256Header)).toBe('sig-mapper');
        expect(await res.text()).toBe(mapperContents);
      });

      test('returns 304 when version matches', async () => {
        const res = await app.request(`/${organizationId}/${federatedGraphId}/manifest/mapper.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenWithFeature}` },
          body: JSON.stringify({ version: 'v1' }),
        });
        expect(res.status).toBe(304);
      });

      test('returns 404 when blob does not exist', async () => {
        const emptyStorage = new InMemoryBlobStorage();
        const otherApp = new Hono();
        cdn(otherApp, {
          authJwtSecret: secretKey,
          authAdmissionJwtSecret: secretAdmissionKey,
          blobStorage: emptyStorage,
        });

        const res = await otherApp.request(`/${organizationId}/${federatedGraphId}/manifest/mapper.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenWithFeature}` },
          body: JSON.stringify({ version: '' }),
        });
        expect(res.status).toBe(404);
      });

      test('returns 400 when org/graph ID mismatch', async () => {
        const res = await app.request(`/wrong-org/${federatedGraphId}/manifest/mapper.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenWithFeature}` },
          body: JSON.stringify({ version: '' }),
        });
        expect(res.status).toBe(400);
      });
    });

    describe('latest.json', () => {
      test('returns latest manifest blob content', async () => {
        const res = await app.request(`/${organizationId}/${federatedGraphId}/manifest/latest.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenWithFeature}` },
          body: JSON.stringify({ version: '' }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/json; charset=UTF-8');
        expect(await res.text()).toBe(latestContents);
      });

      test('returns 304 when version matches', async () => {
        const res = await app.request(`/${organizationId}/${federatedGraphId}/manifest/latest.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenWithFeature}` },
          body: JSON.stringify({ version: 'v1' }),
        });
        expect(res.status).toBe(304);
      });

      test('returns 404 when blob does not exist', async () => {
        const emptyStorage = new InMemoryBlobStorage();
        const otherApp = new Hono();
        cdn(otherApp, {
          authJwtSecret: secretKey,
          authAdmissionJwtSecret: secretAdmissionKey,
          blobStorage: emptyStorage,
        });

        const res = await otherApp.request(`/${organizationId}/${federatedGraphId}/manifest/latest.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenWithFeature}` },
          body: JSON.stringify({ version: '' }),
        });
        expect(res.status).toBe(404);
      });
    });

    describe('feature-flags/:name.json', () => {
      test('returns feature flag blob content', async () => {
        const res = await app.request(`/${organizationId}/${federatedGraphId}/manifest/feature-flags/my-flag.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenWithFeature}` },
          body: JSON.stringify({ version: '' }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/json; charset=UTF-8');
        expect(await res.text()).toBe(featureFlagContents);
      });

      test('returns 304 when version matches', async () => {
        const res = await app.request(`/${organizationId}/${federatedGraphId}/manifest/feature-flags/my-flag.json`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenWithFeature}` },
          body: JSON.stringify({ version: 'v1' }),
        });
        expect(res.status).toBe(304);
      });

      test('returns 404 when blob does not exist', async () => {
        const res = await app.request(
          `/${organizationId}/${federatedGraphId}/manifest/feature-flags/nonexistent.json`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenWithFeature}` },
            body: JSON.stringify({ version: '' }),
          },
        );
        expect(res.status).toBe(404);
      });
    });
  });
});
