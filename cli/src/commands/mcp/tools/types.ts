import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BaseCommandOptions } from '../../../core/types/types.js';

export type ToolContext = {
  opts: BaseCommandOptions;
  server: McpServer;
};
