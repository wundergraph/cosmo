import client, { Registry } from 'prom-client';
import fp from 'fastify-plugin';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { FastifyListenOptions } from 'fastify/types/instance.js';

declare module 'fastify' {
  interface FastifyInstance {
    metricsServer: Fastify.FastifyInstance;
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
    logger: metricsLogger,
  });

  client.collectDefaultMetrics({ register: registry });

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
