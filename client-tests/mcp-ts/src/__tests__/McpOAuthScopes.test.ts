/**
 * MCP OAuth Scope Enforcement — E2E Tests
 *
 * Validates the Cosmo Router's MCP OAuth 2.1 scope enforcement from an MCP
 * client's perspective, using raw HTTP requests and the official MCP TypeScript
 * SDK. The router enforces scopes at five additive levels; these tests verify
 * each level returns the correct HTTP status and WWW-Authenticate challenge.
 *
 * ## Test Sections
 *
 *   A. Metadata Discovery
 *      - Protected Resource Metadata (RFC 9728) exposes scopes_supported
 *      - Authorization Server Metadata (RFC 8414) exposes endpoints
 *
 *   B. Dynamic Client Registration (DCR)
 *      - Register a new client via RFC 7591 and obtain tokens
 *
 *   C. Operation-Level Scope Enforcement
 *      - initialize requires mcp:connect
 *      - tools/list requires mcp:tools:read
 *      - tools/list rejected without mcp:tools:read (403)
 *
 *   D. Per-Tool Scope Enforcement (@requiresScopes)
 *      - Scoped tools rejected without per-tool scopes (403)
 *      - Scoped tools allowed with correct OR-of-AND scope group
 *      - Unscoped tools allowed with base scopes
 *      - scope_challenge_include_token_scopes includes held scopes in challenge
 *
 *   E. tools_call Gate
 *      - tools/call rejected without mcp:tools:call (403)
 *
 *   F. Built-in Tool Scope Enforcement
 *      - execute_graphql requires mcp:graphql:execute
 *      - get_schema requires mcp:schema:read
 *      - get_operation_info requires mcp:ops:read
 *      - Each tested with reject (403) and allow (200)
 *
 *   G. MCP SDK Client E2E (ClientCredentialsProvider)
 *      - Full connect → list → call flow via the MCP TypeScript SDK
 *      - Verifies scoped tool throws 403 when scopes are missing
 *
 * ## Scope Hierarchy (mcp.test.config.yaml)
 *
 *   | Level              | Scopes                  | Gates                              |
 *   |--------------------|-------------------------|------------------------------------|
 *   | Initialize         | mcp:connect             | All HTTP requests                  |
 *   | tools/list         | mcp:tools:read          | Discovering tools                  |
 *   | tools/call (any)   | mcp:tools:call          | Calling any tool                   |
 *   | execute_graphql    | mcp:graphql:execute     | Arbitrary GraphQL queries          |
 *   | get_schema         | mcp:schema:read         | Introspecting the schema           |
 *   | get_operation_info | mcp:ops:read            | Viewing operation metadata         |
 *   | Per-tool           | @requiresScopes scopes  | Calling specific scoped operations |
 *
 * ## Prerequisites
 *
 *   1. Start the test OAuth server:
 *        go run ./router-tests/cmd/oauth-server
 *   2. Start the router with the test config (from repo root):
 *        go run ./router/cmd/router -config client-tests/mcp-ts/mcp.test.config.yaml
 *   3. Run the tests:
 *        cd client-tests/mcp-ts && pnpm test
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ClientCredentialsProvider } from '@modelcontextprotocol/sdk/client/auth-extensions.js';
import { describe, it, expect, beforeAll } from 'vitest';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:5026/mcp';
const MCP_BASE_URL = MCP_SERVER_URL.replace(/\/mcp$/, '');
const OAUTH_SERVER_URL = process.env.OAUTH_SERVER_URL || 'http://localhost:9099';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch JSON from a URL. */
async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json() as Promise<T>;
}

/** Register a new OAuth client via DCR. Returns client_id + client_secret. */
async function registerClient(registrationEndpoint: string): Promise<{ clientId: string; clientSecret: string }> {
  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'MCP E2E Test (DCR)',
      redirect_uris: ['http://localhost:6274/oauth/callback'],
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
    }),
  });
  if (!res.ok) throw new Error(`DCR failed: ${res.status}`);
  const body = (await res.json()) as { client_id: string; client_secret: string };
  return { clientId: body.client_id, clientSecret: body.client_secret };
}

/** Get an access token via client_credentials grant (Basic auth). */
async function getToken(
  tokenEndpoint: string,
  clientId: string,
  clientSecret: string,
  scope: string,
): Promise<{ access_token: string; scope: string }> {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope }),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  return res.json() as Promise<{ access_token: string; scope: string }>;
}

/**
 * Send a raw JSON-RPC request to the MCP endpoint and return the HTTP response.
 * Does NOT follow the SSE stream — returns the raw response for header inspection.
 */
async function rawMcpRequest(token: string, sessionId: string | null, body: object): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  return fetch(MCP_SERVER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

/** Extract the Mcp-Session-Id from an initialize response. */
function getSessionId(res: Response): string {
  const sid = res.headers.get('mcp-session-id');
  if (!sid) throw new Error('No Mcp-Session-Id header in response');
  return sid;
}

/** Parse the WWW-Authenticate header into key-value pairs. */
function parseWWWAuthenticate(res: Response): Record<string, string> {
  const header = res.headers.get('www-authenticate');
  if (!header) return {};
  const params: Record<string, string> = {};
  for (const match of header.matchAll(/(\w+)="([^"]*)"/g)) {
    params[match[1]] = match[2];
  }
  return params;
}

/** Initialize an MCP session and return the session ID. */
async function initSession(token: string): Promise<string> {
  const res = await rawMcpRequest(token, null, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
  });
  if (res.status !== 200) throw new Error(`Initialize failed: ${res.status}`);
  return getSessionId(res);
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let tokenEndpoint: string;
let registrationEndpoint: string;
let clientId: string;
let clientSecret: string;

// ==========================================================================
// Test Suites
// ==========================================================================

describe('MCP OAuth Scope Enforcement E2E', () => {
  // ------------------------------------------------------------------------
  // Setup: discover endpoints + register a client via DCR
  // ------------------------------------------------------------------------
  beforeAll(async () => {
    // 1. Discover protected resource metadata
    const resourceMeta = await fetchJSON<{
      authorization_servers: string[];
      scopes_supported: string[];
    }>(`${MCP_BASE_URL}/.well-known/oauth-protected-resource/mcp`);

    expect(resourceMeta.authorization_servers).toContain(OAUTH_SERVER_URL);
    expect(resourceMeta.scopes_supported).toEqual(expect.arrayContaining(['mcp:connect', 'mcp:tools:read']));

    // 2. Discover authorization server metadata
    const asMeta = await fetchJSON<{
      token_endpoint: string;
      registration_endpoint: string;
    }>(`${OAUTH_SERVER_URL}/.well-known/oauth-authorization-server`);

    tokenEndpoint = asMeta.token_endpoint;
    registrationEndpoint = asMeta.registration_endpoint;

    // 3. Dynamic Client Registration
    const client = await registerClient(registrationEndpoint);
    clientId = client.clientId;
    clientSecret = client.clientSecret;
  });

  // ========================================================================
  // A. Metadata Discovery
  // ========================================================================

  describe('Metadata Discovery', () => {
    it('should expose protected resource metadata with all scopes', async () => {
      const meta = await fetchJSON<{
        resource: string;
        authorization_servers: string[];
        scopes_supported: string[];
        bearer_methods_supported: string[];
      }>(`${MCP_BASE_URL}/.well-known/oauth-protected-resource/mcp`);

      expect(meta.resource).toBe(MCP_SERVER_URL);
      expect(meta.authorization_servers).toEqual([OAUTH_SERVER_URL]);
      expect(meta.bearer_methods_supported).toContain('header');
      expect(meta.scopes_supported).toEqual(expect.arrayContaining(['mcp:connect', 'mcp:tools:read']));
    });

    it('should expose authorization server metadata', async () => {
      const meta = await fetchJSON<{
        issuer: string;
        token_endpoint: string;
        registration_endpoint: string;
        grant_types_supported: string[];
      }>(`${OAUTH_SERVER_URL}/.well-known/oauth-authorization-server`);

      expect(meta.issuer).toBe(OAUTH_SERVER_URL);
      expect(meta.token_endpoint).toBeTruthy();
      expect(meta.registration_endpoint).toBeTruthy();
      expect(meta.grant_types_supported).toContain('client_credentials');
    });
  });

  // ========================================================================
  // B. Dynamic Client Registration + Token Acquisition
  // ========================================================================

  describe('Dynamic Client Registration', () => {
    it('should register a new client and obtain a token', async () => {
      const newClient = await registerClient(registrationEndpoint);
      expect(newClient.clientId).toMatch(/^dyn-/);
      expect(newClient.clientSecret).toBeTruthy();

      // Verify the DCR client can obtain a token
      const token = await getToken(tokenEndpoint, newClient.clientId, newClient.clientSecret, 'mcp:connect');
      expect(token.access_token).toBeTruthy();
      expect(token.scope).toContain('mcp:connect');
    });

    it('should obtain a token with multiple scopes', async () => {
      const token = await getToken(tokenEndpoint, clientId, clientSecret, 'mcp:connect mcp:tools:read read:all');
      expect(token.access_token).toBeTruthy();
      expect(token.scope).toContain('mcp:connect');
      expect(token.scope).toContain('mcp:tools:read');
      expect(token.scope).toContain('read:all');
    });
  });

  // ========================================================================
  // C. MCP Operation-Level Scope Enforcement (raw HTTP)
  // ========================================================================

  describe('Operation-Level Scope Enforcement', () => {
    it('should allow initialize with mcp:connect scope', async () => {
      const { access_token } = await getToken(tokenEndpoint, clientId, clientSecret, 'mcp:connect');

      const res = await rawMcpRequest(access_token, null, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('mcp-session-id')).toBeTruthy();
    });

    it('should reject tools/list with only mcp:connect (missing mcp:tools:read)', async () => {
      const { access_token } = await getToken(tokenEndpoint, clientId, clientSecret, 'mcp:connect');
      const sessionId = await initSession(access_token);

      const res = await rawMcpRequest(access_token, sessionId, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

      expect(res.status).toBe(403);

      const auth = parseWWWAuthenticate(res);
      expect(auth.error).toBe('insufficient_scope');
      expect(auth.scope).toContain('mcp:tools:read');
      expect(auth.resource_metadata).toContain('.well-known/oauth-protected-resource');
    });

    it('should allow tools/list with mcp:connect + mcp:tools:read', async () => {
      const { access_token } = await getToken(tokenEndpoint, clientId, clientSecret, 'mcp:connect mcp:tools:read');
      const sessionId = await initSession(access_token);

      const res = await rawMcpRequest(access_token, sessionId, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

      expect(res.status).toBe(200);
    });
  });

  // ========================================================================
  // D. Per-Tool Scope Enforcement (raw HTTP)
  // ========================================================================

  describe('Per-Tool Scope Enforcement', () => {
    const BASE_CALL_SCOPES = 'mcp:connect mcp:tools:read mcp:tools:call';

    it('should reject scoped tool with only base scopes', async () => {
      const { access_token } = await getToken(tokenEndpoint, clientId, clientSecret, BASE_CALL_SCOPES);
      const sessionId = await initSession(access_token);

      const res = await rawMcpRequest(access_token, sessionId, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_employee_start_date', arguments: { id: 1 } },
      });

      expect(res.status).toBe(403);

      const auth = parseWWWAuthenticate(res);
      expect(auth.error).toBe('insufficient_scope');
      expect(auth.error_description).toContain('get_employee_start_date');
      expect(auth.scope).toBeTruthy();
    });

    it('should allow scoped tool with read:all', async () => {
      const { access_token } = await getToken(tokenEndpoint, clientId, clientSecret, `${BASE_CALL_SCOPES} read:all`);
      const sessionId = await initSession(access_token);

      const res = await rawMcpRequest(access_token, sessionId, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_employee_start_date', arguments: { id: 1 } },
      });

      expect(res.status).toBe(200);
    });

    it('should allow scoped tool with read:employee + read:private (alternative AND-group)', async () => {
      const { access_token } = await getToken(
        tokenEndpoint,
        clientId,
        clientSecret,
        `${BASE_CALL_SCOPES} read:employee read:private`,
      );
      const sessionId = await initSession(access_token);

      const res = await rawMcpRequest(access_token, sessionId, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_employee_start_date', arguments: { id: 1 } },
      });

      expect(res.status).toBe(200);
    });

    it('should allow unscoped tool with just base scopes', async () => {
      const { access_token } = await getToken(tokenEndpoint, clientId, clientSecret, BASE_CALL_SCOPES);
      const sessionId = await initSession(access_token);

      const res = await rawMcpRequest(access_token, sessionId, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_employees', arguments: {} },
      });

      expect(res.status).toBe(200);
    });

    it('should include existing scopes in challenge when partially scoped', async () => {
      const { access_token } = await getToken(
        tokenEndpoint,
        clientId,
        clientSecret,
        `${BASE_CALL_SCOPES} read:employee`,
      );
      const sessionId = await initSession(access_token);

      const res = await rawMcpRequest(access_token, sessionId, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_employee_start_date', arguments: { id: 1 } },
      });

      expect(res.status).toBe(403);

      const auth = parseWWWAuthenticate(res);
      expect(auth.error).toBe('insufficient_scope');
      // With scope_challenge_include_token_scopes: true, the challenge includes
      // both the held scope (read:employee) and the missing one (read:private)
      const challengedScopes = auth.scope?.split(' ') ?? [];
      expect(challengedScopes).toContain('read:employee');
      expect(challengedScopes).toContain('read:private');
    });
  });

  // ========================================================================
  // E. tools_call Gate (raw HTTP)
  // ========================================================================

  describe('tools_call Gate', () => {
    it('should reject tools/call without mcp:tools:call scope', async () => {
      const { access_token } = await getToken(tokenEndpoint, clientId, clientSecret, 'mcp:connect mcp:tools:read');
      const sessionId = await initSession(access_token);

      const res = await rawMcpRequest(access_token, sessionId, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_employees', arguments: {} },
      });

      expect(res.status).toBe(403);

      const auth = parseWWWAuthenticate(res);
      expect(auth.error).toBe('insufficient_scope');
      expect(auth.scope).toContain('mcp:tools:call');
    });
  });

  // ========================================================================
  // F. Built-in Tool Scope Enforcement (raw HTTP)
  // ========================================================================

  describe('Built-in Tool Scope Enforcement', () => {
    const BASE_CALL_SCOPES = 'mcp:connect mcp:tools:read mcp:tools:call';

    // -- execute_graphql --------------------------------------------------

    it('should reject execute_graphql without mcp:graphql:execute scope', async () => {
      const { access_token } = await getToken(tokenEndpoint, clientId, clientSecret, BASE_CALL_SCOPES);
      const sessionId = await initSession(access_token);

      const res = await rawMcpRequest(access_token, sessionId, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'execute_graphql', arguments: { query: '{ employees { id } }' } },
      });

      expect(res.status).toBe(403);

      const auth = parseWWWAuthenticate(res);
      expect(auth.error).toBe('insufficient_scope');
      expect(auth.scope).toContain('mcp:graphql:execute');
    });

    it('should allow execute_graphql with mcp:graphql:execute scope', async () => {
      const { access_token } = await getToken(
        tokenEndpoint,
        clientId,
        clientSecret,
        `${BASE_CALL_SCOPES} mcp:graphql:execute`,
      );
      const sessionId = await initSession(access_token);

      const res = await rawMcpRequest(access_token, sessionId, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'execute_graphql', arguments: { query: '{ employees { id } }' } },
      });

      expect(res.status).toBe(200);
    });

    // -- get_schema -------------------------------------------------------

    it('should reject get_schema without mcp:schema:read scope', async () => {
      const { access_token } = await getToken(tokenEndpoint, clientId, clientSecret, BASE_CALL_SCOPES);
      const sessionId = await initSession(access_token);

      const res = await rawMcpRequest(access_token, sessionId, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_schema', arguments: {} },
      });

      expect(res.status).toBe(403);

      const auth = parseWWWAuthenticate(res);
      expect(auth.error).toBe('insufficient_scope');
      expect(auth.scope).toContain('mcp:schema:read');
    });

    it('should allow get_schema with mcp:schema:read scope', async () => {
      const { access_token } = await getToken(
        tokenEndpoint,
        clientId,
        clientSecret,
        `${BASE_CALL_SCOPES} mcp:schema:read`,
      );
      const sessionId = await initSession(access_token);

      const res = await rawMcpRequest(access_token, sessionId, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_schema', arguments: {} },
      });

      expect(res.status).toBe(200);
    });

    // -- get_operation_info ------------------------------------------------

    it('should reject get_operation_info without mcp:ops:read scope', async () => {
      const { access_token } = await getToken(tokenEndpoint, clientId, clientSecret, BASE_CALL_SCOPES);
      const sessionId = await initSession(access_token);

      const res = await rawMcpRequest(access_token, sessionId, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_operation_info', arguments: { operationName: 'GetEmployees' } },
      });

      expect(res.status).toBe(403);

      const auth = parseWWWAuthenticate(res);
      expect(auth.error).toBe('insufficient_scope');
      expect(auth.scope).toContain('mcp:ops:read');
    });

    it('should allow get_operation_info with mcp:ops:read scope', async () => {
      const { access_token } = await getToken(
        tokenEndpoint,
        clientId,
        clientSecret,
        `${BASE_CALL_SCOPES} mcp:ops:read`,
      );
      const sessionId = await initSession(access_token);

      const res = await rawMcpRequest(access_token, sessionId, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_operation_info', arguments: { operationName: 'GetEmployees' } },
      });

      expect(res.status).toBe(200);
    });
  });

  // ========================================================================
  // G. MCP SDK Client — Full E2E with ClientCredentialsProvider
  // ========================================================================

  describe('MCP SDK Client E2E', () => {
    /** Helper to create a connected MCP client with given scopes. */
    async function createClient(scope: string): Promise<Client> {
      const provider = new ClientCredentialsProvider({
        clientId,
        clientSecret,
        scope,
      });

      const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), {
        authProvider: provider,
      });

      const client = new Client({ name: 'e2e-sdk-test', version: '1.0.0' }, { capabilities: {} });

      await client.connect(transport);
      return client;
    }

    it('should connect, list tools, and call an unscoped tool', async () => {
      const client = await createClient('mcp:connect mcp:tools:read mcp:tools:call');

      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThan(0);

      const toolNames = tools.tools.map((t) => t.name);
      expect(toolNames).toContain('get_employees');
      expect(toolNames).toContain('get_employee_start_date');

      const result = await client.callTool({ name: 'get_employees', arguments: {} });
      expect(result.content).toBeDefined();

      await client.close();
    });

    it('should connect and call a scoped tool with sufficient scopes', async () => {
      const client = await createClient('mcp:connect mcp:tools:read mcp:tools:call read:all');

      const result = await client.callTool({
        name: 'get_employee_start_date',
        arguments: { id: 1 },
      });

      expect(result.content).toBeDefined();

      await client.close();
    });

    it('should surface a 403 error when calling a scoped tool without per-tool scopes', async () => {
      const client = await createClient('mcp:connect mcp:tools:read mcp:tools:call');

      // Calling a scoped tool without per-tool scopes should throw.
      // The MCP client is responsible for handling this 403 and acquiring
      // the additional scopes indicated in the WWW-Authenticate header.
      await expect(client.callTool({ name: 'get_employee_start_date', arguments: { id: 1 } })).rejects.toThrow(/403/);

      await client.close();
    });
  });
});
