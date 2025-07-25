import process from 'node:process';
import { pino } from 'pino';
import { createRedisConnections } from '../core/plugins/redis.js';
import { DeleteUserQueue } from '../core/workers/DeleteUser.js';
import { getConfig } from './get-config.js';

const { redis } = getConfig();

const userId = process.env.USER_ID || '';
const userEmail = process.env.USER_EMAIL || '';

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

const deleteUserQueue = new DeleteUserQueue(logger, redisQueue);

await deleteUserQueue.addJob({
  userId,
  userEmail,
});

redisQueue.disconnect();
redisWorker.disconnect();
