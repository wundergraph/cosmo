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
  tls?: {
    // Necessary only if the server uses a self-signed certificate.
    ca?: string;
    // Necessary only if the server requires client certificate authentication.
    key?: string;
    cert?: string;
  };
}

export default fp<RedisPluginOptions>(async function (fastify, opts) {
  const connectionConfig: IORedis.RedisOptions = {
    connectionName: 'controlplane',
    host: opts.host,
    port: opts.port,
    password: opts.password,
    maxRetriesPerRequest: 0, // required for bullmq
  };

  if (opts.tls) {
    const sslOptions: tls.TlsOptions = {
      rejectUnauthorized: false,
      ca: opts.tls.ca,
      cert: opts.tls.cert,
      key: opts.tls.key,
    };

    // Check if the ca is a file and read it.
    if (opts.tls.ca && path.extname(opts.tls.ca)) {
      sslOptions.ca = await readFile(opts.tls.ca, 'utf8');
    }
    // Check if the cert is a file and read it.
    if (opts.tls.cert && path.extname(opts.tls.cert)) {
      sslOptions.cert = await readFile(opts.tls.cert, 'utf8');
    }

    // Check if the key is a file and read it.
    if (opts.tls.key && path.extname(opts.tls.key)) {
      sslOptions.key = await readFile(opts.tls.key, 'utf8');
    }

    connectionConfig.tls = {
      ca: sslOptions.ca,
      cert: sslOptions.cert,
      key: sslOptions.key,
      rejectUnauthorized: sslOptions.rejectUnauthorized,
    };
  }

  const redis = new IORedis.Redis(connectionConfig);

  fastify.decorate('redisHealthcheck', async () => {
    try {
      await redis.ping();

      fastify.log.debug('Redis connection healthcheck succeeded');
    } catch (error) {
      fastify.log.error(error);
      throw new Error('Redis connection healthcheck failed');
    }
  });

  await fastify.redisHealthcheck();

  fastify.decorate<IORedis.Redis>('redis', redis);
});
