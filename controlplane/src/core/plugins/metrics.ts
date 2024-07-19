import client, { Registry } from 'prom-client';
import fp from 'fastify-plugin';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { FastifyListenOptions } from 'fastify/types/instance.js';

const register = new Registry();

declare module 'fastify' {
  interface FastifyInstance {
    metricsServer: Fastify.FastifyInstance;
    startMetricsServer(opts: FastifyListenOptions): Promise<string>;
  }
}

export interface MetricsPluginOptions {
  enabled?: boolean;
  path?: string;
}

const handler = async function (request: FastifyRequest, reply: FastifyReply) {
  const metrics = await register.metrics();
  reply.send(metrics);
};

export default fp<MetricsPluginOptions>(function (fastify, { path = '/metrics' }, next) {
  const metricsLogger = fastify.log.child({ module: 'metrics' });
  const listener = Fastify({
    logger: metricsLogger,
  });

  client.collectDefaultMetrics({ register });

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
