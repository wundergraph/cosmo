import process from 'node:process';
import { pino } from 'pino';
import { DeactivateOrganizationQueue } from '../core/workers/DeactivateOrganization.js';
import { createRedisConnections } from '../core/plugins/redis.js';
import { getConfig } from './get-config.js';

const { organizationSlug, redis } = getConfig();

const organizationId = process.env.ORGANIZATION_ID || '';
const deactivationReason = process.env.ORGANIZATION_DEACTIVATION_REASON;

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

const deactivateOrganizationQueue = new DeactivateOrganizationQueue(logger, redisQueue);

await deactivateOrganizationQueue.addJob({
  organizationId,
  organizationSlug,
  deactivationReason,
});

redisQueue.disconnect();
redisWorker.disconnect();
