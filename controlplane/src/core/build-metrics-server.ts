import client from 'prom-client';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import { cors, createContextValues } from '@connectrpc/connect';
import fastifyCors from '@fastify/cors';
import { fastifyConnectPlugin } from '@connectrpc/connect-fastify';
import { pino, stdTimeFunctions, LoggerOptions } from 'pino';

export interface PrometheusConfig {
  prometheus: {
    path: string;
  };
}

export interface BuildConfig {
  production?: boolean;
  logger: LoggerOptions;
  allowedOrigins?: string[];
}

const developmentLoggerOpts: LoggerOptions = {
  transport: {
    target: 'pino-pretty',
    options: {
      singleLine: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  },
};

const handler = async function (request: FastifyRequest, reply: FastifyReply) {
  const metrics = await client.register.metrics();
  reply.send(metrics);
};

export default async function build(opts: BuildConfig & PrometheusConfig) {
  opts.logger = {
    timestamp: stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => {
        return {
          level: label,
        };
      },
    },
    ...opts.logger,
  };

  const logger = pino(opts.production ? opts.logger : { ...developmentLoggerOpts, ...opts.logger });

  const fastify = Fastify({
    logger,
  });
  const collectDefaultMetrics = client.collectDefaultMetrics;
  collectDefaultMetrics({});

  await fastify.register(fastifyCors, {
    // Produce an error if allowedOrigins is undefined
    origin: opts.allowedOrigins || [],
  });

  await fastify.route({
    method: 'GET',
    url: opts.prometheus.path,
    handler,
  });

  return fastify;
}
