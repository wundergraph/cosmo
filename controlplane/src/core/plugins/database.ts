import { readFile } from 'node:fs/promises';
import * as tls from 'node:tls';
import path from 'node:path';
import fp from 'fastify-plugin';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../../db/schema.js';
import { RunMigration } from '../migrate.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: PostgresJsDatabase<typeof schema>;
    dbHealthcheck(): Promise<void>;
  }
}

export interface DatabaseConnectionConfig {
  tls?: {
    // Necessary only if the server uses a self-signed certificate.
    ca?: string;
    // Necessary only if the server requires client certificate authentication.
    key?: string;
    cert?: string;
  };
}

export interface DbPluginOptions {
  databaseConnectionUrl: string;
  debugSQL?: boolean;
  gracefulTimeoutSec?: number;
  runMigration?: boolean;
}

export const buildDatabaseConnectionConfig = async (
  opts?: DatabaseConnectionConfig,
): Promise<postgres.Options<any>> => {
  const connectionConfig: postgres.Options<any> = {};

  if (opts?.tls) {
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

    connectionConfig.ssl = sslOptions;
  }

  return connectionConfig;
};

export default fp<DbPluginOptions & DatabaseConnectionConfig>(async function (fastify, opts) {
  const connectionConfig = await buildDatabaseConnectionConfig(opts);
  connectionConfig.onnotice = (notice) => {
    fastify.log.debug(notice, 'Database notice');
  };

  const queryConnection = postgres(opts.databaseConnectionUrl, connectionConfig);
  const db = drizzle(queryConnection, {
    schema: { ...schema },
    logger: opts.debugSQL,
  });

  if (opts.runMigration) {
    await RunMigration(opts.databaseConnectionUrl);
  }

  fastify.decorate('dbHealthcheck', async () => {
    try {
      await db.execute(sql`SELECT 1`);

      fastify.log.debug('Database connection healthcheck succeeded');
    } catch (error) {
      fastify.log.error(error);
      throw new Error('Database connection healthcheck failed');
    }
  });
  fastify.addHook('onClose', async () => {
    fastify.log.debug('Closing database connection ...');

    await queryConnection.end({
      timeout: opts.gracefulTimeoutSec ?? 5,
    });

    fastify.log.debug('Database connection closed');
  });

  await fastify.dbHealthcheck();

  fastify.decorate<typeof db>('db', db);
});
