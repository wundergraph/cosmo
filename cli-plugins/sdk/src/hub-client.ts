import { z } from 'zod';
import { Bearer } from './credentials.js';
import { errorMessage, failure, ok, Result } from './result.js';

const protocolVersion = '2025-06-18';

export type ToolArgument = string | number | boolean | null | ToolArgument[] | { [key: string]: ToolArgument };

export interface SchemaPushRequest {
  sandboxYaml: string;
  subgraphs: Array<{ name: string; sdl: string }>;
  sha: string;
}

export interface HubClient {
  /** Calls one tool on Hub's MCP endpoint and validates its structured result. */
  callTool<T>(name: string, args: Record<string, ToolArgument>, schema: z.ZodType<T>): Promise<Result<T>>;
  /** Posts a schema push from CI to `POST /ci/schema-push`. */
  pushSchema<T>(request: SchemaPushRequest, schema: z.ZodType<T>): Promise<Result<T>>;
}

const jsonRpcResponse = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]).nullable().optional(),
  result: z.record(z.string(), z.json()).optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

const toolResult = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).default([]),
  structuredContent: z.json().optional(),
  isError: z.boolean().optional(),
});

/** Streamable HTTP may answer with an SSE stream; the JSON-RPC response is the last `data:` event. */
const readJsonRpcBody = async (response: Response): Promise<string> => {
  const body = await response.text();
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    return body;
  }
  const events = body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim());
  return events.at(-1) ?? '';
};

const parseJson = (text: string): Result<z.core.util.JSONType> => {
  try {
    return ok(z.json().parse(JSON.parse(text)));
  } catch (error) {
    return failure(`Hub returned a response that is not JSON: ${text.slice(0, 200)}`, error as Error);
  }
};

export const createHubClient = ({
  baseUrl,
  bearer,
  clientVersion,
  fetchImpl = fetch,
}: {
  baseUrl: string;
  bearer: () => Promise<Result<Bearer>>;
  clientVersion: string;
  fetchImpl?: typeof fetch;
}): HubClient => {
  const endpoint = (path: string) => new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  let nextId = 1;
  let session: { id: string | undefined } | undefined;

  const post = async (
    path: string,
    body: object,
    sessionId: string | undefined,
  ): Promise<Result<{ response: Response; text: string }>> => {
    const credentials = await bearer();
    if (!credentials.success) {
      return credentials;
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${credentials.data.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': protocolVersion,
      'user-agent': `wgc/${clientVersion}`,
    };
    if (sessionId) {
      headers['mcp-session-id'] = sessionId;
    }

    let response: Response;
    try {
      response = await fetchImpl(endpoint(path), { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (error) {
      return failure(`Could not reach Hub at ${baseUrl}.`, error as Error);
    }
    if (response.status === 401 || response.status === 403) {
      return failure(
        credentials.data.kind === 'ci-oidc'
          ? 'Hub rejected the CI OIDC token. Check that this repository is trusted in Hub and the audience matches.'
          : 'Hub rejected the sign-in token. Run `wgc auth login` again.',
      );
    }
    const text = await readJsonRpcBody(response);
    if (!response.ok && response.status !== 202) {
      return failure(`Hub answered HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return ok({ response, text });
  };

  const rpc = async (
    method: string,
    params: Record<string, ToolArgument>,
    sessionId: string | undefined,
  ): Promise<Result<{ result: Record<string, z.core.util.JSONType>; sessionId: string | undefined }>> => {
    const sent = await post('mcp', { jsonrpc: '2.0', id: nextId++, method, params }, sessionId);
    if (!sent.success) {
      return sent;
    }
    const json = parseJson(sent.data.text);
    if (!json.success) {
      return json;
    }
    const parsed = jsonRpcResponse.safeParse(json.data);
    if (!parsed.success) {
      return failure(`Hub returned a malformed JSON-RPC response to ${method}.`);
    }
    if (parsed.data.error) {
      return failure(`Hub ${method} failed: ${parsed.data.error.message}`);
    }
    return ok({
      result: parsed.data.result ?? {},
      sessionId: sent.data.response.headers.get('mcp-session-id') ?? sessionId,
    });
  };

  const ensureSession = async (): Promise<Result<string | undefined>> => {
    if (session) {
      return ok(session.id);
    }
    const initialized = await rpc(
      'initialize',
      { protocolVersion, capabilities: {}, clientInfo: { name: 'wgc', version: clientVersion } },
      undefined,
    );
    if (!initialized.success) {
      return initialized;
    }
    const notified = await post(
      'mcp',
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      initialized.data.sessionId,
    );
    if (!notified.success) {
      return notified;
    }
    session = { id: initialized.data.sessionId };
    return ok(session.id);
  };

  return {
    async callTool(name, args, schema) {
      const sessionId = await ensureSession();
      if (!sessionId.success) {
        return sessionId;
      }
      const called = await rpc('tools/call', { name, arguments: args }, sessionId.data);
      if (!called.success) {
        return called;
      }
      const result = toolResult.safeParse(called.data.result);
      if (!result.success) {
        return failure(`Hub returned a malformed result for ${name}.`);
      }
      const text = result.data.content
        .map((part) => part.text ?? '')
        .join('\n')
        .trim();
      if (result.data.isError) {
        return failure(text || `Hub tool ${name} failed.`);
      }

      let payload: z.core.util.JSONType;
      if (result.data.structuredContent === undefined) {
        const parsedText = parseJson(text);
        if (!parsedText.success) {
          return failure(`Hub tool ${name} returned text that is not JSON: ${errorMessage(parsedText)}`);
        }
        payload = parsedText.data;
      } else {
        payload = result.data.structuredContent;
      }

      const typed = schema.safeParse(payload);
      if (!typed.success) {
        return failure(`Hub tool ${name} returned an unexpected shape: ${typed.error.message}`);
      }
      return ok(typed.data);
    },

    async pushSchema(request, schema) {
      const sent = await post('ci/schema-push', request, undefined);
      if (!sent.success) {
        return sent;
      }
      const json = parseJson(sent.data.text);
      if (!json.success) {
        return json;
      }
      const typed = schema.safeParse(json.data);
      if (!typed.success) {
        return failure(`Hub returned an unexpected schema push result: ${typed.error.message}`);
      }
      return ok(typed.data);
    },
  };
};
