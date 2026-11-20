import { z } from 'zod';
import type { Output } from '@wundergraph/wgc-plugin-sdk';
import type { HubRuntime } from './runtime.js';

/**
 * The portal tunnel protocol, version 1: JSON text frames over one WebSocket wgc opens to Hub.
 * wgc says `hello` with the portal's credential, Hub answers `ready` or `refused`, then sends each
 * request the sandbox's router makes, which wgc answers with the local service's `response` under
 * the same id. Hub sends `closed` once the portal closes anywhere, and `ping` to keep it open.
 */
export const portalProtocolVersion = 1;

const serverFrame = z.discriminatedUnion('_tag', [
  z.object({ _tag: z.literal('ready'), portalId: z.string(), subgraph: z.string() }),
  z.object({ _tag: z.literal('refused'), code: z.string(), message: z.string() }),
  z.object({
    _tag: z.literal('request'),
    id: z.string(),
    method: z.string(),
    path: z.string(),
    headers: z.record(z.string(), z.string()),
    body: z.string(),
  }),
  z.object({ _tag: z.literal('closed'), reason: z.string() }),
  z.object({ _tag: z.literal('ping') }),
]);

type ServerFrame = z.output<typeof serverFrame>;

type RequestFrame = Extract<ServerFrame, { _tag: 'request' }>;

/** One WebSocket as the tunnel uses it, so tests can stand in for Hub without a network. */
export interface TunnelSocket {
  send(text: string): void;
  close(): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: () => void): void;
}

/** A WebSocket from Node's global client. */
export const openWebSocket = (url: string): TunnelSocket => {
  const socket = new WebSocket(url);
  return {
    send: (text) => socket.send(text),
    close: () => socket.close(),
    onOpen: (listener) => socket.addEventListener('open', listener),
    onMessage: (listener) => socket.addEventListener('message', (event) => listener(String(event.data))),
    onClose: (listener) => socket.addEventListener('close', listener),
  };
};

/** Why the tunnel stopped: Ctrl-C, the portal closed in Hub, or Hub refused the credential. */
export type TunnelEnd =
  | { kind: 'interrupted' }
  | { kind: 'closed'; reason: string }
  | { kind: 'refused'; code: string; message: string };

/** How one connection ended, before the loop decides whether to reconnect. */
type ConnectionEnd = TunnelEnd | { kind: 'dropped'; wasReady: boolean };

/** Request headers that describe the hop through Hub, not the request. */
const hopHeaders = new Set(['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding']);

/** Response headers fetch already acted on, which would mislead the router if passed along. */
const decodedHeaders = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection']);

const maxBackoffMs = 15_000;

const withoutHeaders = (headers: Record<string, string>, dropped: Set<string>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => !dropped.has(name.toLowerCase())));

/** A GraphQL error body, so the router shows the developer why their subgraph did not answer. */
const unreachableBody = (localUrl: string, reason: string): string =>
  JSON.stringify({
    errors: [{ message: `Nothing answers on ${localUrl} (${reason}). Start your subgraph there.` }],
  });

export interface TunnelOptions {
  tunnelUrl: string;
  credential: string;
  localUrl: string;
  clientVersion: string;
  output: Output;
  runtime: HubRuntime;
}

/** Calls the local subgraph for one request from Hub and returns the response frame. */
const answerLocally = async (request: RequestFrame, options: TunnelOptions): Promise<string> => {
  const started = options.runtime.now().getTime();
  let status: number;
  let headers: Record<string, string>;
  let body: string;

  try {
    const response = await fetch(options.localUrl, {
      method: request.method,
      headers: withoutHeaders(request.headers, hopHeaders),
      body: request.method === 'GET' ? undefined : request.body,
    });
    status = response.status;
    headers = withoutHeaders(Object.fromEntries(response.headers.entries()), decodedHeaders);
    body = await response.text();
  } catch (error) {
    const reason = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
    status = 502;
    headers = { 'content-type': 'application/json' };
    body = unreachableBody(options.localUrl, reason);
    options.output.message(`  ! ${options.localUrl} did not answer: ${reason}`, {
      event: 'portal_local_unreachable',
      url: options.localUrl,
      reason,
    });
  }

  const durationMs = options.runtime.now().getTime() - started;
  options.output.message(`  ${request.method} ${request.path}  ${status}  ${durationMs}ms`, {
    event: 'portal_request',
    method: request.method,
    path: request.path,
    status,
    duration_ms: durationMs,
  });
  return JSON.stringify({ _tag: 'response', id: request.id, status, headers, body });
};

/** Runs one connection until it drops, Hub closes or refuses it, or `abort` fires. */
const connectOnce = (options: TunnelOptions, abort: AbortSignal): Promise<ConnectionEnd> =>
  new Promise((resolve) => {
    const socket = options.runtime.openSocket(options.tunnelUrl);
    let ended: ConnectionEnd | undefined;
    let ready = false;

    const end = (outcome: ConnectionEnd) => {
      if (ended === undefined) {
        ended = outcome;
        socket.close();
        resolve(outcome);
      }
    };

    const onAbort = () => end({ kind: 'interrupted' });
    abort.addEventListener('abort', onAbort, { once: true });

    socket.onOpen(() => {
      socket.send(
        JSON.stringify({
          _tag: 'hello',
          credential: options.credential,
          client: `wgc/${options.clientVersion}`,
          protocol: portalProtocolVersion,
        }),
      );
    });

    socket.onMessage((text) => {
      const parsed = serverFrame.safeParse(JSON.parse(text));
      if (!parsed.success) {
        return;
      }

      const frame = parsed.data;
      if (frame._tag === 'ready') {
        ready = true;
        options.output.message(`Connected. ${frame.subgraph} requests now reach ${options.localUrl}`, {
          event: 'portal_status',
          status: 'connected',
        });
        return;
      }
      if (frame._tag === 'refused') {
        end({ kind: 'refused', code: frame.code, message: frame.message });
        return;
      }
      if (frame._tag === 'closed') {
        end({ kind: 'closed', reason: frame.reason });
        return;
      }
      if (frame._tag === 'request') {
        answerLocally(frame, options).then(
          (response) => socket.send(response),
          () => undefined,
        );
      }
    });

    socket.onClose(() => {
      abort.removeEventListener('abort', onAbort);
      end({ kind: 'dropped', wasReady: ready });
    });
  });

/**
 * Keeps the portal's tunnel open: reconnects with backoff whenever the connection drops, until
 * Ctrl-C, the portal closes in Hub, or Hub refuses the credential.
 */
export const runTunnel = async (options: TunnelOptions): Promise<TunnelEnd> => {
  const abort = new AbortController();
  const stopListening = options.runtime.onInterrupt(() => abort.abort());
  let backoffMs = 1000;

  try {
    while (true) {
      const outcome = await connectOnce(options, abort.signal);
      if (outcome.kind !== 'dropped') {
        return outcome;
      }
      if (abort.signal.aborted) {
        return { kind: 'interrupted' };
      }

      backoffMs = outcome.wasReady ? 1000 : Math.min(backoffMs * 2, maxBackoffMs);
      options.output.message(`Reconnecting in ${Math.round(backoffMs / 1000)}s: the connection to Hub dropped`, {
        event: 'portal_status',
        status: 'reconnecting',
      });
      await options.runtime.sleep(backoffMs);
      if (abort.signal.aborted) {
        return { kind: 'interrupted' };
      }
    }
  } finally {
    stopListening();
  }
};
