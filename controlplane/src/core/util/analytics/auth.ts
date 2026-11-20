import type { HandlerContext } from '@connectrpc/connect';
import { isMcpClient, MCP_CLIENT_HEADER } from '@wundergraph/cosmo-shared';
import type { AuthContext } from '../../../types/index.js';
import type { RouterOptions } from '../../routes.js';

/**
 * Whether a request comes from `wgc mcp`. The header is a client opt-in, not a credential: spoofing it only adds rate
 * limiting and skips the API key's last-used update.
 */
const isMcpRequest = (headers: Headers): boolean => isMcpClient(headers.get(MCP_CLIENT_HEADER));

/**
 * Authenticates a read of analytics data. A request from `wgc mcp` leaves the API key's last-used time alone (the
 * analytics tools write nothing) and counts against the organization's MCP rate limit.
 */
export async function authenticateAnalyticsRead(opts: RouterOptions, ctx: HandlerContext): Promise<AuthContext> {
  const mcp = isMcpRequest(ctx.requestHeader);
  const authContext = await opts.authenticator.authenticate(ctx.requestHeader, { skipApiKeyUsageUpdate: mcp });
  if (mcp && opts.analyticsRateLimiter) {
    await opts.analyticsRateLimiter.take(authContext.organizationId);
  }
  return authContext;
}
