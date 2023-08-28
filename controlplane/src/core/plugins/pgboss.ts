import tls from 'node:tls';
import { readFile } from 'node:fs/promises';
import fp from 'fastify-plugin';
import PgBoss from 'pg-boss';
import './pgboss.js';

declare module 'fastify' {
  interface FastifyInstance {
    pgboss: PgBoss;
  }
}

export interface PgBossOptions {
  databaseConnectionUrl: string;
  ssl?: {
    // Necessary only if the server uses a self-signed certificate.
    caPath?: string;
    // Necessary only if the server requires client certificate authentication.
    keyPath?: string;
    certPath?: string;
  };
}

export default fp<PgBossOptions>(async function PgBossPlugin(fastify, opts) {
  const config: PgBoss.ConstructorOptions = {
    connectionString: opts.databaseConnectionUrl,
    application_name: 'controlplane',
    // How many days a job may be in created or retry state before it's archived. Must be >=1
    retentionDays: 30,
    // How many minutes a job may be in active state before it is failed because of expiration. Must be >=1
    expireInMinutes: 15,
    // Specifies how long in seconds completed jobs get archived (12 hours).
    archiveCompletedAfterSeconds: 12 * 60 * 60,
    // Specifies how long in seconds failed jobs get archived (12 hours).
    archiveFailedAfterSeconds: 12 * 60 * 60,
    // When jobs in the archive table become eligible for deletion.
    deleteAfterDays: 30,
    // How often maintenance operations are run against the job and archive tables.
    maintenanceIntervalMinutes: 1,
  };

  if (opts.ssl) {
    const sslOptions: tls.ConnectionOptions = {
      rejectUnauthorized: false,
    };

    // Necessary only if the server uses a self-signed certificate.
    if (opts.ssl.caPath) {
      sslOptions.key = await readFile(opts.ssl.caPath, 'utf8');
    }

    // Necessary only if the server requires client certificate authentication.
    if (opts.ssl.certPath) {
      sslOptions.cert = await readFile(opts.ssl.certPath, 'utf8');
    }

    if (opts.ssl.keyPath) {
      sslOptions.key = await readFile(opts.ssl.keyPath, 'utf8');
    }

    config.ssl = sslOptions;
  }

  const boss = new PgBoss(config);

  boss.on('error', (error) => fastify.log.error(error, 'PgBoss error'));

  await boss.start();

  boss.on('wip', (data) => {
    const progress = data.filter((worker) => worker.state === 'active').length;
    const failed = data.filter((worker) => worker.state === 'failed').length;
    // @ts-ignore https://github.com/timgit/pg-boss/issues/422
    const stopping = data.filter((worker) => worker.state === 'stopping').length;

    fastify.log.debug({ progress, stopping, failed }, `PgBoss Worker report`);
  });

  fastify.addHook('onClose', async () => {
    const destroy = process.env.NODE_ENV !== 'production';
    fastify.log.info({ gracePeriod: '30s', destroy }, 'Shutting down PgBoss ...');

    const stopOptions: PgBoss.StopOptions = {
      timeout: 30_000,
      graceful: true,
      destroy,
    };
    await boss.stop(stopOptions);

    // Wait until pgBoss has gracefully stopped.
    // https://github.com/timgit/pg-boss/issues/421
    await new Promise((resolve) => {
      boss.once('stopped', () => {
        fastify.log.info('PgBoss stopped');
        resolve(undefined);
      });
    });

    fastify.log.info('PgBoss shutdown complete');
  });

  fastify.decorate<PgBoss>('pgboss', boss);
});
