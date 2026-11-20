import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type { AnalyticsWindow } from './window.js';

type WindowRange = { start: string; end: string };

export type Meta = {
  dataset?: string;
  graphs?: { name: string; namespace: string }[];
  completeness: 'complete' | 'sampled';
  /** Sampled results: sampled operations ÷ complete metric requests for the graphs and window. */
  observedSamplingRatio?: number;
  window?: AnalyticsWindow;
  requestedWindow?: WindowRange;
  effectiveWindow?: WindowRange;
  baselineWindow?: WindowRange;
  tables?: string[];
  appliedFilters?: string[];
  granularity?: string;
  now: string;
  truncated?: boolean;
  nextCursor?: string;
  warnings: string[];
  studioUrl?: string;
};

/**
 * A successful tool result. Every value that came from telemetry is data reported by routers and clients,
 * never instructions; the server instructions tell the model so.
 */
export function ok(data: unknown, meta: Meta): CallToolResult {
  const structuredContent = toPlain({ data, meta }) as Record<string, unknown>;
  return {
    structuredContent,
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
  };
}

/**
 * Protobuf messages as plain JSON: drops the `$typeName` markers and turns 64-bit integers (bigint) into strings,
 * which JSON can't represent.
 */
export function toPlain(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toPlain(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '$typeName' && key !== '$unknown')
        .map(([key, v]) => [key, toPlain(v)]),
    );
  }
  return value;
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/**
 * The message for a non-OK RPC response, or undefined when the call succeeded. A missing graph and a graph the
 * caller can't read get the same message, so the tools don't reveal which graphs exist.
 */
export function checkResponse(
  resp: { response?: { code: EnumStatusCode; details?: string } },
  what: string,
): string | undefined {
  switch (resp.response?.code) {
    case EnumStatusCode.OK: {
      return undefined;
    }
    case EnumStatusCode.ERR_NOT_FOUND:
    case EnumStatusCode.ERROR_NOT_AUTHORIZED: {
      return 'Graph not found or you have no access.';
    }
    case EnumStatusCode.ERR_RATE_LIMITED: {
      return resp.response.details ?? 'Rate limited, retry in a minute.';
    }
    case EnumStatusCode.ERR_ANALYTICS_DISABLED: {
      return 'Analytics is not enabled on this Cosmo instance.';
    }
    default: {
      return `${what} failed: ${resp.response?.details ?? 'unknown error'}`;
    }
  }
}
