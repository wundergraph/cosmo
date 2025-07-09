import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BaseCommandOptions } from '@/core/types';

export type ToolContext = {
  opts: BaseCommandOptions;
  server: McpServer;
};
