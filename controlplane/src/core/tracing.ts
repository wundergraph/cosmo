import * as Sentry from '@sentry/node';
import type { Span } from '@sentry/node';

type OpenTelemetrySpanProcessor = NonNullable<Sentry.NodeOptions['openTelemetrySpanProcessors']>[number];

/**
 * Every span currently open, keyed by trace id.
 *
 * Sentry exports a span only when it ends, and attaches it to the transaction only if
 * every ancestor up to the root has ended too. A single unfinished ancestor drops the
 * whole subtree, so an aborted request has to close the intermediate spans as well as
 * its own -- hence keying by trace rather than by what this module opened.
 */
const openSpansByTrace = new Map<string, Set<Span>>();

/** Registers every span the SDK starts, including instrumentation spans we never see. */
class OpenSpanRegistry implements OpenTelemetrySpanProcessor {
  onStart(span: any): void {
    const traceId = span?.spanContext?.()?.traceId;
    if (!traceId) {
      return;
    }
    let open = openSpansByTrace.get(traceId);
    if (!open) {
      open = new Set();
      openSpansByTrace.set(traceId, open);
    }
    open.add(span);
  }

  onEnd(span: any): void {
    const traceId = span?.spanContext?.()?.traceId;
    const open = traceId ? openSpansByTrace.get(traceId) : undefined;
    if (!open) {
      return;
    }
    open.delete(span);
    if (open.size === 0) {
      openSpansByTrace.delete(traceId);
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    openSpansByTrace.clear();
    return Promise.resolve();
  }
}

/** Pass to `Sentry.init({ openTelemetrySpanProcessors: [openSpanRegistry] })`. */
export const openSpanRegistry: OpenTelemetrySpanProcessor = new OpenSpanRegistry();

// eslint-disable-next-line @typescript-eslint/ban-types
function wrapMethod(className: string, key: string, original: Function) {
  return function (this: any, ...args: any[]) {
    return Sentry.startSpan({ name: `${className}.${key}` }, () => original.apply(this, args));
  };
}

/**
 * Class decorator that wraps all prototype methods with Sentry spans.
 * Every method call creates a child span named "ClassName.methodName"
 * under the active transaction.
 *
 * When Sentry is disabled, startSpan is a no-op passthrough.
 */
export function traced<T extends new (...args: any[]) => any>(target: T): T {
  const className = target.name;
  const proto = target.prototype;

  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (!descriptor || typeof descriptor.value !== 'function') {
      continue;
    }
    Object.defineProperty(proto, key, {
      ...descriptor,
      value: wrapMethod(className, key, descriptor.value),
    });
  }

  return target;
}

/**
 * Wraps a function call with a Sentry span.
 * Use for ad-hoc tracing of service calls, auth, etc.
 */
export function withSpan<T>(name: string, fn: () => Promise<T> | T): Promise<T> | T {
  return Sentry.startSpan({ name }, fn);
}

/**
 * Runs `fn`, and on `signal` abort ends every span still open in the same trace, marking
 * them `deadline_exceeded`. The work itself is not cancelled, so a force-ended span
 * reports the duration observed up to the abort, not how long the work took.
 */
export async function withRequestSpans<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  const active = Sentry.getActiveSpan();
  const traceId = active ? Sentry.spanToJSON(active).trace_id : undefined;
  // Left for the HTTP instrumentation to end, so it ends last and the exporter has the
  // children buffered when it flushes.
  const rootSpan = active ? Sentry.getRootSpan(active) : undefined;

  const endOpenSpans = () => {
    const open = traceId ? openSpansByTrace.get(traceId) : undefined;
    if (!open) {
      return;
    }
    // Copied on purpose: ending a span fires onEnd, which deletes it from this very set.
    // eslint-disable-next-line unicorn/no-useless-spread
    for (const span of [...open]) {
      if (span === rootSpan) {
        continue;
      }
      span.setStatus({ code: 2, message: 'deadline_exceeded' });
      span.setAttribute('cosmo.span.ended_by', 'request_aborted');
      span.end();
    }
  };

  if (!signal || signal.aborted) {
    return fn();
  }

  signal.addEventListener('abort', endOpenSpans, { once: true });
  try {
    return await fn();
  } finally {
    signal.removeEventListener('abort', endOpenSpans);
  }
}
