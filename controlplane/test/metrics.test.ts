import { describe, expect, test, beforeAll } from 'vitest';
import Fastify from 'fastify';
import metrics from '../src/core/plugins/metrics.js';

describe('Metrics endpoint', () => {
  test('Should return 200', async (testContext) => {
    const server = Fastify();
    const options = {
      host: 'localhost',
      path: '/metrics',
      port: 0,
    }
    await server.register(metrics, options);
    await server.listen({
        port: 0,
    });

    testContext.onTestFailed(async () => await server.close());

    const resp = await server.inject({
      method: 'GET',
      url: {
        hostname: options.host,
        port: options.port,
        pathname: options.path,
      },
    });

    expect(resp.statusCode).toBe(200);
    await server.close();
  });
});