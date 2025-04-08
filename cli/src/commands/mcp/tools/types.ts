import { BaseCommandOptions } from '../../../core/types/types.js';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ToolContext = {
    opts: BaseCommandOptions;
    server: McpServer;
}; 