import { describe, expect, test, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import metrics from '../src/core/plugins/metrics.js';

describe('Metrics endpoint', () => {
  let server: any;
  const options = {
    host: 'localhost',
    path: '/metrics',
    // note this can clash with other local running services
    port: 9095,
  };
  beforeAll(async () => {
    server = Fastify();
    await server.register(metrics, options);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });
  test('Should return 200', async (testContext) => {
    testContext.onTestFailed(async () => await server.close());
    const resp = await fetch(`http://${options.host}:${options.port}${options.path}`);

    expect(resp.status).toBe(200);
    await server.close();
  });
});
