import fp from 'fastify-plugin';
import { BaseLogger } from 'pino';
import { ClickHouseClient } from '../clickhouse/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    ch?: ClickHouseClient;
    chHealthcheck(): void;
  }
}

export interface ChPluginOptions {
  dsn: string;
  logger: BaseLogger;
}

export default fp<ChPluginOptions>(function ClickHousePlugin(fastify, opts, done) {
  const connection = new ClickHouseClient({
    dsn: opts.dsn,
    logger: opts.logger,
    httpConfig: {
      timeout: 60_000,
    },
  });

  fastify.decorate('chHealthcheck', () => {
    connection.addEventListener('ping', (event) => {
      if (event.detail.error) {
        fastify.log.error(new Error(`ClickHouse connection healthcheck failed. Attempt: ${event.detail.attempt}`));
        fastify.log.error(event.detail.error);
        return;
      }

      fastify.log.debug('ClickHouse connection healthcheck succeeded');
    });

    return connection.ping();
  });

  fastify.chHealthcheck();

  fastify.decorate<ClickHouseClient>('ch', connection);

  done();
});
