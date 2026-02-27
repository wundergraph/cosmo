import process from 'node:process';
import { pino } from 'pino';
import { createRedisConnections } from '../core/plugins/redis.js';
import { ReactivateOrganizationQueue } from '../core/workers/ReactivateOrganization.js';
import { getConfig } from './get-config.js';

const { organizationSlug, redis } = getConfig();

const organizationId = process.env.ORGANIZATION_ID || '';

const { redisQueue, redisWorker } = await createRedisConnections({
  host: redis.host!,
  port: Number(redis.port),
  password: redis.password,
  tls: redis.tls,
});

await redisQueue.connect();
await redisWorker.connect();
await redisWorker.ping();
await redisQueue.ping();

const logger = pino();

const reactivateOrganizationQueue = new ReactivateOrganizationQueue(logger, redisQueue);

await reactivateOrganizationQueue.addJob({
  organizationId,
  organizationSlug,
});

redisQueue.disconnect();
redisWorker.disconnect();
