import { readFile } from 'node:fs/promises';
import * as tls from 'node:tls';
import path from 'node:path';
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
  password?: string;
  ssl?: {
    // Necessary only if the server uses a self-signed certificate.
    ca?: string;
    // Necessary only if the server requires client certificate authentication.
    key?: string;
    cert?: string;
  };
}

export default fp<RedisPluginOptions>(async function (fastify, opts) {
  const connectionConfig: IORedis.RedisOptions = {};

  if (opts.ssl) {
    const sslOptions: tls.TlsOptions = {
      rejectUnauthorized: false,
    };

    // Check if the ca is a path and read it.
    if (opts.ssl.ca && opts.ssl.ca !== path.basename(opts.ssl.ca)) {
      sslOptions.ca = await readFile(opts.ssl.ca, 'utf8');
    }
    // Check if the cert is a path and read it.
    if (opts.ssl.cert && opts.ssl.cert !== path.basename(opts.ssl.cert)) {
      sslOptions.cert = await readFile(opts.ssl.cert, 'utf8');
    }

    // Check if the key is a path and read it.
    if (opts.ssl.key && opts.ssl.key !== path.basename(opts.ssl.key)) {
      sslOptions.key = await readFile(opts.ssl.key, 'utf8');
    }

    connectionConfig.tls = {
      ca: sslOptions.ca,
      cert: sslOptions.cert,
      key: sslOptions.key,
      rejectUnauthorized: sslOptions.rejectUnauthorized,
    };
  }

  const redis = new IORedis.Redis({
    connectionName: 'controlplane',
    host: opts.host,
    port: opts.port,
    password: opts.password,
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
