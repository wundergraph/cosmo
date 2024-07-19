import { describe, expect, test } from 'vitest';
import Fastify from 'fastify';
import metrics from '../src/core/plugins/metrics.js';

describe('Metrics endpoint', () => {
  test('Should return base process and environment metrics', async (testContext) => {
    const server = Fastify();

    await server.register(metrics, {
      path: '/metrics',
    });

    await server.ready();

    testContext.onTestFinished(() => server.close());

    const resp = await server.metricsServer.inject({ method: 'GET', url: '/metrics' });

    expect(resp.statusCode).toBe(200);
    expect(resp.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');

    expect(resp.payload).toContain('process_cpu_user_seconds_total');
    expect(resp.payload).toContain('process_cpu_system_seconds_total');
    expect(resp.payload).toContain('process_cpu_seconds_total');
    expect(resp.payload).toContain('process_resident_memory_bytes');
    expect(resp.payload).toContain('process_start_time_seconds');
    expect(resp.payload).toContain('nodejs_eventloop_lag_seconds');
  });
});
