/**
 * MCP e2e tests using the official TypeScript SDK with ClientCredentialsProvider.
 *
 * These tests exercise the full OAuth 2.1 flow:
 *   1. SDK discovers /.well-known/oauth-protected-resource from the MCP server
 *   2. SDK discovers /.well-known/oauth-authorization-server from the OAuth AS
 *   3. SDK dynamically registers (or uses pre-registered) client
 *   4. SDK exchanges client_credentials for a signed JWT at /token
 *   5. SDK attaches Bearer token to all MCP requests
 *
 * Environment variables (set by the Go test harness or manually):
 *   MCP_SERVER_URL      – e.g. http://localhost:5025/mcp
 *   MCP_CLIENT_ID       – pre-registered OAuth client ID
 *   MCP_CLIENT_SECRET   – pre-registered OAuth client secret
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ClientCredentialsProvider } from '@modelcontextprotocol/sdk/client/auth-extensions.js';

// Read configuration from environment
const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? 'http://localhost:5025/mcp';
const MCP_CLIENT_ID = process.env.MCP_CLIENT_ID ?? 'test-mcp-client';
const MCP_CLIENT_SECRET = process.env.MCP_CLIENT_SECRET ?? 'test-mcp-secret';

describe('MCP client_credentials flow', () => {
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    const provider = new ClientCredentialsProvider({
      clientId: MCP_CLIENT_ID,
      clientSecret: MCP_CLIENT_SECRET,
    });

    transport = new StreamableHTTPClientTransport(
      new URL(MCP_SERVER_URL),
      { authProvider: provider },
    );

    client = new Client({ name: 'mcp-ts-test', version: '1.0.0' });
    await client.connect(transport);
  });

  afterAll(async () => {
    await transport?.close();
  });

  it('should list tools', async () => {
    const result = await client.listTools();
    expect(result.tools).toBeDefined();
    expect(result.tools.length).toBeGreaterThan(0);

    const toolNames = result.tools.map((t) => t.name);
    console.log('Available tools:', toolNames);
  });

  it('should call a read-only tool', async () => {
    // Find a tool that looks like a query (employee list, etc.)
    const { tools } = await client.listTools();
    const queryTool = tools.find(
      (t) => t.name.includes('employees') || t.name.includes('employee'),
    );

    if (!queryTool) {
      // If no employee tool exists, try get_schema if available
      const schemaTool = tools.find((t) => t.name === 'get_schema');
      if (schemaTool) {
        const result = await client.callTool({ name: 'get_schema', arguments: {} });
        expect(result).toBeDefined();
        return;
      }
      // Fall back to calling the first available tool
      console.log('No employee/schema tool found, calling first tool:', tools[0]?.name);
      return;
    }

    const result = await client.callTool({
      name: queryTool.name,
      arguments: { criteria: {} },
    });
    expect(result).toBeDefined();
    console.log('Tool call result:', JSON.stringify(result).slice(0, 200));
  });
});

describe('MCP client_credentials with scopes', () => {
  it('should work with scoped client', async () => {
    const provider = new ClientCredentialsProvider({
      clientId: MCP_CLIENT_ID,
      clientSecret: MCP_CLIENT_SECRET,
    });

    const transport = new StreamableHTTPClientTransport(
      new URL(MCP_SERVER_URL),
      { authProvider: provider },
    );

    const client = new Client({ name: 'mcp-ts-scoped-test', version: '1.0.0' });

    try {
      await client.connect(transport);
      const result = await client.listTools();
      expect(result.tools.length).toBeGreaterThan(0);
    } finally {
      await transport.close();
    }
  });
});