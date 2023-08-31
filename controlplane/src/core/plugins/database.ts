import { readFile } from 'node:fs/promises';
import * as tls from 'node:tls';
import fp from 'fastify-plugin';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../../db/schema.js';
import { start } from '../migrate.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: PostgresJsDatabase<typeof schema>;
    dbHealthcheck(): Promise<void>;
  }
}

export interface DbPluginOptions {
  databaseConnectionUrl: string;
  debugSQL?: boolean;
  gracefulTimeoutSec?: number;
  ssl?: {
    // Necessary only if the server uses a self-signed certificate.
    caPath?: string;
    // Necessary only if the server requires client certificate authentication.
    keyPath?: string;
    certPath?: string;
  };
}

export default fp<DbPluginOptions>(async function (fastify, opts) {
  const connectionConfig: postgres.Options<any> = {
    onnotice(notice) {
      fastify.log.debug(notice);
    },
  };

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

    connectionConfig.ssl = sslOptions;
  }

  const queryConnection = postgres(opts.databaseConnectionUrl, connectionConfig);
  const db = drizzle(queryConnection, {
    schema: { ...schema },
    logger: opts.debugSQL,
  });

  await start(opts.databaseConnectionUrl);

  fastify.decorate('dbHealthcheck', async () => {
    try {
      await db.execute(sql`SELECT 1`);

      fastify.log.debug('Database connection healthcheck succeeded');
    } catch (error) {
      fastify.log.error(error);
      throw new Error('Database connection healthcheck failed');
    }
  });
  fastify.addHook('onClose', () => {
    fastify.log.debug('Closing database connection ...');

    queryConnection.end({
      timeout: opts.gracefulTimeoutSec ?? 5,
    });

    fastify.log.debug('Database connection closed');
  });

  await fastify.dbHealthcheck();

  fastify.decorate<typeof db>('db', db);
});
