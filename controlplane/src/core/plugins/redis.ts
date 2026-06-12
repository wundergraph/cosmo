import { readFile } from 'node:fs/promises';
import * as tls from 'node:tls';
import path from 'node:path';
import fp from 'fastify-plugin';
import IORedis from 'ioredis';
import { ConnectionOptions } from 'bullmq';
import { BaseAdapter, IoredisAdapter } from 'redlock-universal';

declare module 'fastify' {
  interface FastifyInstance {
    redisForWorker: ConnectionOptions;
    redisForQueue: ConnectionOptions;
    lockAdapter: BaseAdapter;
    redisConnect(): Promise<void>;
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

export const createRedisConnections = async (opts: RedisPluginOptions) => {
  const connectionConfig: IORedis.RedisOptions = {
    host: opts.host,
    port: opts.port,
    password: opts.password,
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

  // It's best practice to use a different redis connection for the worker and the queue.
  // The queue should be able to fail fast if redis is not available.
  // The worker should be able to reconnect if redis is not available.

  const redisWorker = new IORedis.Redis({
    ...connectionConfig,
    maxRetriesPerRequest: null, // required for bullmq worker
    connectionName: 'controlplane-worker',
    lazyConnect: true,
  });
  const redisQueue = new IORedis.Redis({
    ...connectionConfig,
    connectionName: 'controlplane-queue',
    // Disable offline queue to let the worker fail fast if redis is not available.
    // In that way, if a user makes a request to the API, it will fail fast instead of waiting for the timeout.
    enableOfflineQueue: false,
    lazyConnect: true,
  });

  const lockAdapter = new IoredisAdapter(
    new IORedis.Redis({
      ...connectionConfig,
      enableOfflineQueue: false,
      lazyConnect: true,
    }),
    { keyPrefix: 'controlplane' },
  );

  return { redisQueue, redisWorker, lockAdapter };
};

export default fp<RedisPluginOptions>(async function (fastify, opts) {
  const { redisQueue, redisWorker, lockAdapter } = await createRedisConnections(opts);

  fastify.decorate('redisConnect', async () => {
    try {
      // Wait explicitly for the connection to be established.
      await redisQueue.connect();
      await redisWorker.connect();
      await lockAdapter.getClient().connect();

      // Healthcheck.
      await redisWorker.ping();
      await redisQueue.ping();
      await lockAdapter.ping();

      fastify.log.debug('Redis connection healthcheck succeeded');
    } catch (error) {
      fastify.log.error(error);
      throw new Error('Redis connection failed');
    }
  });

  await fastify.redisConnect();

  fastify.decorate<IORedis.Redis>('redisForWorker', redisWorker);
  fastify.decorate<IORedis.Redis>('redisForQueue', redisQueue);
  fastify.decorate<BaseAdapter>('lockAdapter', lockAdapter);
});
