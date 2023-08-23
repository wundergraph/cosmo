import { describe, expect, test } from 'vitest';
import Fastify from 'fastify';
import health from '../src/core/plugins/health';

describe('Health endpoint', () => {
  test('Should return 200', async () => {
    const server = Fastify();
    await server.register(health);

    const resp = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(resp.statusCode).toBe(200);
  });
});
