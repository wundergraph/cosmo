import { SignJWT } from 'jose';
import { describe, test, expect } from 'vitest';
import { Context, Hono } from 'hono';
import { BlobStorage, BlobNotFoundError, cdn } from '../dist';

const secretKey = 'hunter2';

const generateToken = async (organizationId: string, federatedGraphId: string, secret: string) => {
  const secretKey = new TextEncoder().encode(secret);
  return await new SignJWT({ organization_id: organizationId, federated_graph_id: federatedGraphId })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(secretKey);
};

class InMemoryBlobStorage implements BlobStorage {
  objects: Map<string, Buffer> = new Map();
  getObject({
    context,
    key,
    cacheControl,
  }: {
    context: Context;
    key: string;
    cacheControl?: string;
  }): Promise<ReadableStream> {
    const obj = this.objects.get(key);
    if (!obj) {
      return Promise.reject(new BlobNotFoundError(`Object with key ${key} not found`));
    }
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(obj);
        controller.close();
      },
    });
    return Promise.resolve(stream);
  }
}

describe('Test JWT authentication', async () => {
  const federatedGraphId = 'federatedGraphId';
  const organizationId = 'organizationId';
  const token = await generateToken(organizationId, federatedGraphId, secretKey);
  const blobStorage = new InMemoryBlobStorage();

  const requestPath = `/${organizationId}/${federatedGraphId}/operations/clientName/operation.json`;

  const app = new Hono();

  cdn(app, {
    authJwtSecret: secretKey,
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
    expect(res.status).toBe(403);
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
});

describe('Test persisted operations handler', async () => {
  const federatedGraphId = 'federatedGraphId';
  const organizationId = 'organizationId';
  const token = await generateToken(organizationId, federatedGraphId, secretKey);
  const blobStorage = new InMemoryBlobStorage();
  const clientName = 'clientName';
  const operationHash = 'operationHash';
  const operationContents = JSON.stringify({ version: 1, body: 'query { hello }' });

  blobStorage.objects.set(
    `${organizationId}/${federatedGraphId}/operations/${clientName}/${operationHash}.json`,
    Buffer.from(operationContents),
  );

  const app = new Hono();

  cdn(app, {
    authJwtSecret: secretKey,
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

describe('Test router config handler', async () => {
  const federatedGraphId = 'federatedGraphId';
  const organizationId = 'organizationId';
  const token = await generateToken(organizationId, federatedGraphId, secretKey);
  const blobStorage = new InMemoryBlobStorage();
  const routerConfig = JSON.stringify({
    version: '1',
    engineConfig: {
      defaultFlushInterval: '500',
      datasourceConfigurations: [],
      fieldConfigurations: [],
      graphqlSchema: '',
      stringStorage: {},
    },
    subgraphs: [],
  });

  blobStorage.objects.set(`${organizationId}/${federatedGraphId}/routerConfigs/latest.json`, Buffer.from(routerConfig));

  const app = new Hono();

  cdn(app, {
    authJwtSecret: secretKey,
    blobStorage,
  });

  test('it returns a router config', async () => {
    const res = await app.request(`/${organizationId}/${federatedGraphId}/routerconfigs/latest.json`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(""),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(routerConfig);
  });

  test('it returns a 404 if the router config does not exist', async () => {
    const res = await app.request(`/${organizationId}/${federatedGraphId}/routerconfigs/does_not_exist.json`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(res.status).toBe(404);
  });

  test('it returns a 204 if the version is the same as before', async () => {
    const res = await app.request(`/${organizationId}/${federatedGraphId}/routerconfigs/latest.json`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ version: '1' }),
    });
    expect(res.status).toBe(204);
  });
});
