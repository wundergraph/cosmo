import type { HandlerContext } from '@connectrpc/connect';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { RateLimitedError } from '../errors/errors.js';
import type { RouterOptions } from '../routes.js';

/**
 * Per-organization budget for analytics requests from MCP clients, so a runaway agent can't load ClickHouse for
 * everyone. Fixed one-minute windows in Redis, shared by all controlplane instances. Fails open: if Redis is
 * unavailable, requests are allowed and a warning is logged.
 */
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

/** The header MCP clients send. Only their requests count against the analytics budget. */
export const MCP_CLIENT_HEADER = 'x-cosmo-client';

/**
 * Whether a request comes from the `wgc mcp` analytics tools. The header is a client opt-in, not a credential:
 * spoofing it only adds rate limiting and skips the API key's last-used update.
 */
export const isMcpRequest = (headers: Headers): boolean =>
  headers.get(MCP_CLIENT_HEADER)?.startsWith('wgc-mcp/') ?? false;

export async function enforceAnalyticsRateLimit(
  opts: RouterOptions,
  ctx: HandlerContext,
  organizationId: string,
): Promise<void> {
  if (!opts.analyticsRateLimiter || !isMcpRequest(ctx.requestHeader)) {
    return;
  }
  await opts.analyticsRateLimiter.take(organizationId);
}
