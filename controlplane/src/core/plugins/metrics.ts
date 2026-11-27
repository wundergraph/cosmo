import client, { Registry } from 'prom-client';
import fp from 'fastify-plugin';
import Fastify, { FastifyRequest, FastifyReply, FastifyInstance, FastifyListenOptions } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    metricsServer: FastifyInstance;
    startMetricsServer(opts: FastifyListenOptions): Promise<string>;
  }
}

export interface MetricsPluginOptions {
  enabled?: boolean;
  registry?: Registry;
  path?: string;
}

export default fp<MetricsPluginOptions>(function (fastify, { path = '/metrics', registry = new Registry() }, next) {
  const metricsLogger = fastify.log.child({
    plugin: 'metrics',
  });
  const listener = Fastify({
    loggerInstance: metricsLogger,
  });

  client.collectDefaultMetrics({ register: registry });

  const requestDuration = new client.Histogram({
    name: 'controlplane_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds, labelled by route and status code.',
    labelNames: ['route', 'status_code'] as const,
    // Subgraph checks and publishes can take tens of seconds, so the buckets go past the 120s CLI deadline.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60, 90, 120, 180, 300],
    registers: [registry],
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    // Use the route pattern, not the raw URL, so unknown paths cannot grow the label set.
    const route = request.routeOptions.url ?? 'unmatched';
    requestDuration.observe({ route, status_code: String(reply.statusCode) }, reply.elapsedTime / 1000);
    done();
  });

  listener.route({
    method: 'GET',
    url: path,
    handler: function (request: FastifyRequest, reply: FastifyReply) {
      reply.header('Content-Type', registry.contentType);
      return registry.metrics();
    },
  });

  fastify.addHook('onClose', () => {
    metricsLogger.debug('Closing metrics server');
    return listener.close();
  });

  fastify.decorate('metricsServer', listener);
  fastify.decorate('startMetricsServer', async (opts: FastifyListenOptions) => {
    const address = await listener.listen(opts);
    metricsLogger.debug(`Starting metrics server on ${address}`);
    return address;
  });

  next();
});
