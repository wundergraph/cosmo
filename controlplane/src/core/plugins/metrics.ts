import client, { Registry } from 'prom-client';
import fp from 'fastify-plugin';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';

import { Logger } from 'pino';

const register = new Registry();

export interface MetricsPluginOptions {
  enabled?: boolean;
  logger?: Logger;
  path: string;
  port: number;
  host: string;
}

const handler = async function (request: FastifyRequest, reply: FastifyReply) {
  const metrics = await register.metrics();
  reply.send(metrics);
};

export default fp<MetricsPluginOptions>(async function (fastify, opts) {
  const { host, port, path, logger } = opts;
  const listener = Fastify({
    logger,
  });

  const collectDefaultMetrics = client.collectDefaultMetrics;
  collectDefaultMetrics({ register });

  await listener.route({
    method: 'GET',
    url: path,
    handler,
  });

  await fastify.addHook('onClose', async () => {
    await listener.close();
  });

  await listener.listen({
    host,
    port,
  });
});
