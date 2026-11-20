/**
 * The header `wgc mcp` sets on every request. The controlplane rate-limits analytics requests that carry it and skips
 * the API key's last-used update for them. It is a client opt-in, not a credential.
 */
export const MCP_CLIENT_HEADER = 'x-cosmo-client';

const MCP_CLIENT_PREFIX = 'wgc-mcp/';

/** The header's value for a given CLI version. */
export const mcpClientHeaderValue = (version: string) => `${MCP_CLIENT_PREFIX}${version}`;

/** Whether a header value comes from `wgc mcp`. */
export const isMcpClient = (value: string | null | undefined): boolean => value?.startsWith(MCP_CLIENT_PREFIX) ?? false;
