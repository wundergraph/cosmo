import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BaseCommandOptions } from '../../../core/types/types.js';
import type { AuthProvider } from '../auth.js';

export type ToolContext = {
  opts: BaseCommandOptions;
  server: McpServer;
  /** Request headers for the long-running server: refreshes the login, or uses COSMO_API_KEY. */
  auth: AuthProvider;
};
