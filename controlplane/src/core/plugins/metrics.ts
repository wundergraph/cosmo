import client, { Registry } from 'prom-client';
import fp from 'fastify-plugin';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { FastifyListenOptions } from 'fastify/types/instance.js';

declare module 'fastify' {
  interface FastifyInstance {
    metricsServer: Fastify.FastifyInstance;
    startMetricsServer(opts: FastifyListenOptions): Promise<string>;
  }
  interface FastifyReply {
    promRegistry: Registry;
  }
}

export interface MetricsPluginOptions {
  enabled?: boolean;
  registry?: Registry;
  path?: string;
}

const handler = async function (request: FastifyRequest, reply: FastifyReply) {
  const metrics = await reply.promRegistry.metrics();
  reply.send(metrics);
};

export default fp<MetricsPluginOptions>(function (fastify, { path = '/metrics', registry = new Registry() }, next) {
  const metricsLogger = fastify.log.child({ module: 'metrics' });
  const listener = Fastify({
    logger: metricsLogger,
  });

  listener.decorateReply('promRegistry', registry);

  client.collectDefaultMetrics({ register: registry });

  listener.route({
    method: 'GET',
    url: path,
    handler,
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
