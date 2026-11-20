import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { RateLimitedError } from '../errors/errors.js';
import { traced } from '../tracing.js';

/**
 * Per-organization budget for analytics requests from MCP clients, so a runaway agent can't load ClickHouse for
 * everyone. Fixed one-minute windows in Redis, shared by all controlplane instances. Fails open: if Redis is
 * unavailable, requests are allowed and a warning is logged.
 */
@traced
export class AnalyticsRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly limitPerMinute: number,
    private readonly logger: FastifyBaseLogger,
  ) {}

  public async take(organizationId: string): Promise<void> {
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    const key = `analytics-rl:${organizationId}:${minute}`;

    let count: number;
    try {
      count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, 120);
      }
    } catch (error) {
      this.logger.warn({ error, organizationId }, 'Analytics rate limiter unavailable, allowing request');
      return;
    }

    if (count > this.limitPerMinute) {
      throw new RateLimitedError(Math.ceil(((minute + 1) * 60_000 - now) / 1000));
    }
  }
}
