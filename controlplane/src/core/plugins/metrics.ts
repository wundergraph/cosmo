import client from 'prom-client';
import fp from 'fastify-plugin';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';

import { Logger } from 'pino';

export interface MetricsPluginOptions {
  enabled?: boolean;
  logger?: Logger;
  path: string;
  port: number;
  host: string;
}

const handler = async function (request: FastifyRequest, reply: FastifyReply) {
  const metrics = await client.register.metrics();
  reply.send(metrics);
};

export default fp<MetricsPluginOptions>(async function (fastify, opts) {
  const { host, port, path, logger } = opts;
  const listener = Fastify({
    logger,
  });

  const collectDefaultMetrics = client.collectDefaultMetrics;
  collectDefaultMetrics({});

  await listener.route({
    method: 'GET',
    url: path,
    handler,
  });

  await listener.listen({
    host,
    port,
  });
});
