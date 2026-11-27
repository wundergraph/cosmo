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

  test('Should record request duration by route and status code', async (testContext) => {
    const server = Fastify();

    await server.register(metrics, {
      path: '/metrics',
    });

    server.post('/wg.cosmo.platform.v1.PlatformService/CheckSubgraphSchema', () => ({ ok: true }));

    await server.ready();

    testContext.onTestFinished(() => server.close());

    await server.inject({ method: 'POST', url: '/wg.cosmo.platform.v1.PlatformService/CheckSubgraphSchema' });
    await server.inject({ method: 'GET', url: '/does-not-exist/123' });

    const resp = await server.metricsServer.inject({ method: 'GET', url: '/metrics' });

    expect(resp.statusCode).toBe(200);
    expect(resp.payload).toContain(
      'controlplane_http_request_duration_seconds_count{route="/wg.cosmo.platform.v1.PlatformService/CheckSubgraphSchema",status_code="200"} 1',
    );
    expect(resp.payload).toContain(
      'controlplane_http_request_duration_seconds_bucket{le="300",route="/wg.cosmo.platform.v1.PlatformService/CheckSubgraphSchema",status_code="200"} 1',
    );
    expect(resp.payload).toContain(
      'controlplane_http_request_duration_seconds_count{route="unmatched",status_code="404"} 1',
    );
    expect(resp.payload).not.toContain('does-not-exist');
  });
});
