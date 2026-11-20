import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { AnalyticsRateLimiter } from '../src/core/services/AnalyticsRateLimiter.js';
import { RateLimitedError } from '../src/core/errors/errors.js';
import { genID } from '../src/core/test-util.js';

describe('AnalyticsRateLimiter', () => {
  let redis: Redis;
  const logger = pino({ level: 'silent' });

  beforeAll(() => {
    redis = new Redis({ host: 'localhost', port: 6379, maxRetriesPerRequest: 1 });
  });

  afterAll(async () => {
    await redis.quit();
  });

  test('allows up to the limit per organization and minute, then rejects', async () => {
    const limiter = new AnalyticsRateLimiter(redis, 3, logger);
    const org = genID('org');

    await limiter.take(org);
    await limiter.take(org);
    await limiter.take(org);
    const error = await limiter.take(org).catch((e) => e);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error.code).toBe(EnumStatusCode.ERR_RATE_LIMITED);
    expect(error.message).toMatch(/^Rate limited, retry in \d+s$/);
  });

  test('counts each organization separately', async () => {
    const limiter = new AnalyticsRateLimiter(redis, 1, logger);
    const org1 = genID('org');
    const org2 = genID('org');

    await limiter.take(org1);

    await expect(limiter.take(org2)).resolves.toBe(undefined);
  });

  test('fails open when Redis errors', async () => {
    const broken = {
      incr: () => Promise.reject(new Error('connection refused')),
      expire: () => Promise.reject(new Error('connection refused')),
    } as unknown as Redis;
    const limiter = new AnalyticsRateLimiter(broken, 1, logger);

    await expect(limiter.take('org1')).resolves.toBe(undefined);
    await expect(limiter.take('org1')).resolves.toBe(undefined);
  });
});
