import fp from 'fastify-plugin';
import { BaseLogger } from 'pino';
import { ClickHouseClient } from '../clickhouse/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    ch?: ClickHouseClient;
    chHealthcheck(): Promise<void>;
  }
}

export interface ChPluginOptions {
  dsn: string;
  logger: BaseLogger;
}

export default fp<ChPluginOptions>(async function ClickHousePlugin(fastify, opts) {
  const connection = new ClickHouseClient({
    dsn: opts.dsn,
    logger: opts.logger,
    httpConfig: {
      timeout: 60_000,
    },
  });

  fastify.decorate('chHealthcheck', async () => {
    try {
      await connection.ping();

      fastify.log.debug('ClickHouse connection healthcheck succeeded');
    } catch (error) {
      fastify.log.error(error);
      throw new Error('ClickHouse connection healthcheck failed');
    }
  });

  await fastify.chHealthcheck();

  fastify.decorate<ClickHouseClient>('ch', connection);
});
