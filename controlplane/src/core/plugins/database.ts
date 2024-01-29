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

export interface DbPluginOptions {
  databaseConnectionUrl: string;
  debugSQL?: boolean;
  gracefulTimeoutSec?: number;
  runMigration?: boolean;
  ssl?: {
    // Necessary only if the server uses a self-signed certificate.
    ca?: string;
    // Necessary only if the server requires client certificate authentication.
    key?: string;
    cert?: string;
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

    // Check if the ca is a file and read it.
    if (opts.ssl.ca && path.extname(opts.ssl.ca)) {
      sslOptions.ca = await readFile(opts.ssl.ca, 'utf8');
    }
    // Check if the cert is a file and read it.
    if (opts.ssl.cert && path.extname(opts.ssl.cert)) {
      sslOptions.cert = await readFile(opts.ssl.cert, 'utf8');
    }

    // Check if the key is a file and read it.
    if (opts.ssl.key && path.extname(opts.ssl.key)) {
      sslOptions.key = await readFile(opts.ssl.key, 'utf8');
    }

    connectionConfig.ssl = sslOptions;
  }

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
