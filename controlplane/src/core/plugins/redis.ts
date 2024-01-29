import { readFile } from 'node:fs/promises';
import * as tls from 'node:tls';
import fp from 'fastify-plugin';
import IORedis from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: IORedis.Redis;
    redisHealthcheck(): Promise<void>;
  }
}

export interface RedisPluginOptions {
  host: string;
  port: number;
  ssl?: {
    // Necessary only if the server uses a self-signed certificate.
    caPath?: string;
    // Necessary only if the server requires client certificate authentication.
    keyPath?: string;
    certPath?: string;
  };
}

export default fp<RedisPluginOptions>(async function (fastify, opts) {
  const connectionConfig: IORedis.RedisOptions = {};

  if (opts.ssl) {
    const sslOptions: tls.TlsOptions = {
      rejectUnauthorized: false,
    };

    // Necessary only if the server uses a self-signed certificate.
    if (opts.ssl.caPath) {
      sslOptions.ca = await readFile(opts.ssl.caPath, 'utf8');
    }

    // Necessary only if the server requires client certificate authentication.
    if (opts.ssl.certPath) {
      sslOptions.cert = await readFile(opts.ssl.certPath, 'utf8');
    }

    if (opts.ssl.keyPath) {
      sslOptions.key = await readFile(opts.ssl.keyPath, 'utf8');
    }

    connectionConfig.tls = {
      ca: sslOptions.ca,
      cert: sslOptions.cert,
      key: sslOptions.key,
      rejectUnauthorized: sslOptions.rejectUnauthorized,
    };
  }

  const redis = new IORedis.Redis({
    host: opts.host,
    port: opts.port,
    maxRetriesPerRequest: 0, // required for bullmq
  });

  fastify.decorate('redisHealthcheck', async () => {
    try {
      await redis.ping();

      fastify.log.debug('Redis connection healthcheck succeeded');
    } catch (error) {
      fastify.log.error(error);
      throw new Error('Redis connection healthcheck failed');
    }
  });
  fastify.addHook('onClose', () => {
    fastify.log.debug('Closing redis connection ...');

    redis.disconnect();

    fastify.log.debug('Redis connection closed');
  });

  await fastify.redisHealthcheck();

  fastify.decorate<IORedis.Redis>('redis', redis);
});
