import { describe, expect, test } from 'vitest';
import Fastify from 'fastify';
import health from '../src/core/plugins/health';

describe('Health endpoint', () => {
  test('Should return 200', async (testContext) => {
    const server = Fastify();
    await server.register(health);

    testContext.onTestFailed(async () => await server.close());

    const resp = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(resp.statusCode).toBe(200);
    await server.close();
  });
});
