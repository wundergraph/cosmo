import { z } from 'zod';
import { Bearer } from './credentials.js';
import type { FailureKind } from './exit.js';
import type { Failure } from './output.js';
import { errorMessage, failure, failWith, ok, Result } from './result.js';

const protocolVersion = '2025-06-18';

export type ToolArgument = string | number | boolean | null | ToolArgument[] | { [key: string]: ToolArgument };

export interface CallOptions {
  /** Aborts the request, e.g. when the user detaches from a long poll with Ctrl-C. */
  signal?: AbortSignal;
}

export interface HubClient {
  /** Calls one tool on Hub's MCP endpoint and validates its structured result. */
  callTool<T>(
    name: string,
    args: Record<string, ToolArgument>,
    schema: z.ZodType<T>,
    options?: CallOptions,
  ): Promise<Result<T>>;
  /** Posts JSON to one of Hub's plain HTTP endpoints, such as `ci/subgraph-check`, and validates the answer. */
  postJson<T>(path: string, body: Record<string, ToolArgument>, schema: z.ZodType<T>): Promise<Result<T>>;
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

/** The structured content of a failed Hub tool call, e.g. `{ code: 'FORGE_SOURCE_UNREACHABLE', message, … }`. */
const hubToolError = z.object({
  code: z.string(),
  message: z.string(),
  remediation: z.string().optional(),
  operation_url: z.string().optional(),
  approval_url: z.string().optional(),
  cli: z.string().optional(),
  docs_url: z.string().optional(),
});

/** The `{ error }` body Hub's plain HTTP endpoints answer a refusal with. */
const hubErrorAnswer = z.object({ error: z.string() });

/** Hub error codes that need their own exit code; every other code exits 1. */
const hubErrorKinds: Record<string, FailureKind> = {
  CONFIRMATION_REQUIRED: 'confirmation',
  NOT_LOGGED_IN: 'unauthenticated',
  UNAUTHENTICATED: 'unauthenticated',
  CHECK_FAILED: 'findings',
  COLLECTION_ASSERTIONS_FAILED: 'findings',
};

export const hubFailureKind = (code: string): FailureKind => hubErrorKinds[code] ?? 'failed';

const toHubFailure = (error: z.infer<typeof hubToolError>): Failure => {
  const remediation = [error.remediation, error.approval_url].filter(Boolean).join('\n');
  return {
    kind: hubFailureKind(error.code),
    code: error.code,
    message: error.message,
    remediation: remediation === '' ? undefined : remediation,
    next: error.cli ? [error.cli] : undefined,
    docs: error.docs_url,
    url: error.operation_url ?? error.approval_url,
  };
};

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
  bearer: (target: URL) => Promise<Result<Bearer>>;
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
    signal?: AbortSignal,
  ): Promise<Result<{ response: Response; text: string }>> => {
    const url = endpoint(path);
    const credentials = await bearer(url);
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
      response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (error) {
      return failure(`Could not reach Hub at ${baseUrl}.`, error as Error);
    }
    if (response.status === 401 || response.status === 403) {
      if (credentials.data.kind === 'ci-oidc') {
        return failWith({
          kind: 'unauthenticated',
          message: 'Hub rejected the CI OIDC token.',
          remediation: 'Check that this repository is trusted in Hub and the audience matches.',
        });
      }
      return failWith({
        kind: 'unauthenticated',
        message: 'Hub rejected the sign-in token.',
        remediation: 'Run `wgc auth login` again.',
        next: ['wgc auth login'],
      });
    }
    const text = await readJsonRpcBody(response);
    if (!response.ok && response.status !== 202) {
      const json = parseJson(text);
      const reason = json.success ? hubErrorAnswer.safeParse(json.data) : undefined;
      return failure(
        `Hub answered HTTP ${response.status}: ${reason?.success ? reason.data.error : text.slice(0, 200)}`,
      );
    }
    return ok({ response, text });
  };

  const rpc = async (
    method: string,
    params: Record<string, ToolArgument>,
    sessionId: string | undefined,
    signal?: AbortSignal,
  ): Promise<Result<{ result: Record<string, z.core.util.JSONType>; sessionId: string | undefined }>> => {
    const sent = await post('mcp', { jsonrpc: '2.0', id: nextId++, method, params }, sessionId, signal);
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
    async callTool(name, args, schema, options = {}) {
      const sessionId = await ensureSession();
      if (!sessionId.success) {
        return sessionId;
      }
      const called = await rpc('tools/call', { name, arguments: args }, sessionId.data, options.signal);
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
        const coded = hubToolError.safeParse(result.data.structuredContent);
        if (coded.success) {
          return failWith(toHubFailure(coded.data));
        }
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

    async postJson(path, body, schema) {
      const sent = await post(path, body, undefined);
      if (!sent.success) {
        return sent;
      }
      const json = parseJson(sent.data.text);
      if (!json.success) {
        return json;
      }
      const typed = schema.safeParse(json.data);
      if (!typed.success) {
        return failure(`Hub returned an unexpected answer from ${path}: ${typed.error.message}`);
      }
      return ok(typed.data);
    },
  };
};
