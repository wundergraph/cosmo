import * as schema from '../../db/schema.js';
import type { SplunkHecSettings } from './destination.js';

export const DEFAULT_SOURCETYPE = 'wundergraph:cosmo:audit';
export const DEFAULT_SOURCE = 'cosmo';

/**
 * Bump only for breaking changes to the event body. Splunk users build searches and field extractions on it, so fields
 * must only ever be added.
 */
export const AUDIT_LOG_EVENT_SCHEMA_VERSION = 1;

const COLLECTOR_EVENT_PATH = '/services/collector/event';
const REQUEST_TIMEOUT_MS = 10_000;

export type AuditLogRow = typeof schema.auditLogs.$inferSelect;

/**
 * The endpoint must already be normalized with normalizeHecEndpoint.
 */
export type HecTarget = SplunkHecSettings & { organizationId: string; token: string };

class HecError extends Error {}

/**
 * Accepts the base URL of the collector (https://splunk.example.com:8088), its /services/collector path, or the full
 * /services/collector/event URL, and returns the event endpoint. Returns undefined when the URL can't be used.
 *
 * Endpoints must be HTTPS and not localhost, which on a hosted controlplane is the controlplane itself.
 */
export function normalizeHecEndpoint(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }

  if (url.protocol !== 'https:' || url.hostname === 'localhost' || url.username || url.password) {
    return undefined;
  }

  const path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith(COLLECTOR_EVENT_PATH)) {
    url.pathname = path;
  } else if (path.endsWith('/services/collector')) {
    url.pathname = `${path}/event`;
  } else {
    url.pathname = `${path}${COLLECTOR_EVENT_PATH}`;
  }
  url.search = '';
  url.hash = '';

  return url.toString();
}

export function isValidHecToken(token: string) {
  return /^[\u0021-\u007E]+$/.test(token);
}

export function toHecEvent(log: AuditLogRow, target: Pick<HecTarget, 'index' | 'source' | 'sourcetype'>) {
  return {
    time: log.createdAt.getTime() / 1000,
    source: target.source,
    sourcetype: target.sourcetype,
    ...(target.index ? { index: target.index } : {}),
    event: {
      schema_version: AUDIT_LOG_EVENT_SCHEMA_VERSION,
      id: log.id,
      timestamp: log.createdAt.toISOString(),
      organization: {
        id: log.organizationId,
        slug: log.organizationSlug,
      },
      action: log.auditAction,
      actor: {
        type: log.actorType,
        id: log.actorId,
        name: log.actorDisplayName,
        api_key_name: log.apiKeyName,
      },
      object: {
        type: log.auditableType,
        name: log.auditableDisplayName,
      },
      target: {
        type: log.targetType,
        id: log.targetId,
        name: log.targetDisplayName,
      },
      namespace: {
        id: log.targetNamespaceId,
        name: log.targetNamespaceDisplayName,
      },
    },
  };
}

/**
 * Sends events to a Splunk HTTP Event Collector and returns the reason on failure. HEC batches are concatenated JSON
 * objects, not a JSON array.
 */
export async function sendToHec(target: HecTarget, events: object[]): Promise<string | undefined> {
  try {
    await post(target, events);
  } catch (err: unknown) {
    if (err instanceof HecError) {
      return err.message;
    }
    throw err;
  }
}

async function post(target: HecTarget, events: object[]) {
  if (!isValidHecToken(target.token)) {
    throw new HecError('The HEC token contains invalid characters');
  }

  let res: Response;
  try {
    res = await fetch(target.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Splunk ${target.token}`,
        'Content-Type': 'application/json',
        // Splunk rejects requests without a channel to tokens with indexer acknowledgement enabled. The channel must be
        // a stable GUID, such as the organization ID.
        'X-Splunk-Request-Channel': target.organizationId,
      },
      body: events.map((e) => JSON.stringify(e)).join('\n'),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
    });
  } catch (err: unknown) {
    throw new HecError(`Could not reach collector: ${describeFetchError(err)}`);
  }

  if (res.ok) {
    return;
  }

  // HEC error bodies look like {"text":"Invalid token","code":4}.
  let detail = '';
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'text' in body && typeof body.text === 'string') {
      detail = body.text;
    }
  } catch {
    // The body is not always JSON, e.g. from a proxy in front of Splunk.
  }

  throw new HecError(`Collector responded with ${res.status}${detail ? `: ${detail}` : ''}`);
}

/**
 * fetch only says "fetch failed"; the useful part, such as a TLS error from a self-signed certificate, is in the cause.
 */
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }
  const cause: unknown = err.cause;
  if (cause instanceof Error) {
    const code = 'code' in cause && typeof cause.code === 'string' ? ` (${cause.code})` : '';
    return `${cause.message}${code}`;
  }
  return err.message;
}
