import { SignJWT } from 'jose';
import { describe, test, expect } from 'vitest';
import { Context, Hono } from 'hono';
import { BlobStorage, BlobNotFoundError, cdn, BlobObject, signatureSha256Header } from '../src';

const secretKey = 'hunter2';
const secretAdmissionKey = 'hunter3';

const generateToken = async (organizationId: string, federatedGraphId: string, secret: string) => {
  const secretKey = new TextEncoder().encode(secret);
  return await new SignJWT({ organization_id: organizationId, federated_graph_id: federatedGraphId })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(secretKey);
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

  headObject({ key, schemaVersionId }: { key: string; schemaVersionId: string }): Promise<boolean> {
    const obj = this.objects.get(key);
    if (!obj) {
      return Promise.reject(new BlobNotFoundError(`Object with key ${key} not found`));
    }
    if (obj.metadata?.version === schemaVersionId) {
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

    test('it returns a 401 if the graph or organization ids does not match with the JWT payload', async () => {
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

    test('it returns a 401 if the graph or organization ids does not match with the JWT payload', async () => {
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

    test('it returns a 401 if the graph or organization ids does not match with the JWT payload', async () => {
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

  describe('Test cache warmer opeartions handler', async () => {
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

    test('it returns a 401 if the graph or organization ids does not match with the JWT payload', async () => {
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
});
