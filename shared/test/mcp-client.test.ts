import { describe, expect, test } from 'vitest';
import { isMcpClient, MCP_CLIENT_HEADER, mcpClientHeaderValue } from '../src/index.js';

describe('MCP client header', () => {
  test('names the wgc mcp server and its version', () => {
    expect([MCP_CLIENT_HEADER, mcpClientHeaderValue('0.110.0')]).toEqual(['x-cosmo-client', 'wgc-mcp/0.110.0']);
  });

  test('tells MCP requests apart from other clients', () => {
    expect(['wgc-mcp/0.110.0', 'cosmo-cli/0.110.0', '', null, undefined].map((value) => isMcpClient(value))).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});
