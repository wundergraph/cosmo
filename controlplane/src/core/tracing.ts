import * as Sentry from '@sentry/node';
import type { Span } from '@sentry/node';

type OpenTelemetrySpanProcessor = NonNullable<Sentry.NodeOptions['openTelemetrySpanProcessors']>[number];

/**
 * Every span currently open, keyed by the local root span it belongs to.
 *
 * Sentry exports a span only when it ends, and attaches it to the transaction only if
 * every ancestor up to the root has ended too. A single unfinished ancestor drops the
 * whole subtree, so an aborted request has to close the intermediate spans as well as
 * the ones this module opened.
 *
 * Keyed by root span rather than trace id: concurrent requests share a trace whenever
 * trace context is propagated in, and one aborting must not end another's spans.
 */
const openSpansByRoot = new Map<Span, Set<Span>>();

/** Registers every span the SDK starts, including instrumentation spans we never see. */
class OpenSpanRegistry implements OpenTelemetrySpanProcessor {
  onStart(span: any): void {
    const root = Sentry.getRootSpan(span);
    if (!root) {
      return;
    }
    let open = openSpansByRoot.get(root);
    if (!open) {
      open = new Set();
      openSpansByRoot.set(root, open);
    }
    open.add(span);
  }

  onEnd(span: any): void {
    const root = Sentry.getRootSpan(span);
    const open = root ? openSpansByRoot.get(root) : undefined;
    if (!open) {
      return;
    }
    open.delete(span);
    if (open.size === 0) {
      openSpansByRoot.delete(root);
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    openSpansByRoot.clear();
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
  // Left for the HTTP instrumentation to end, so it ends last and the exporter has the
  // children buffered when it flushes.
  const rootSpan = active ? Sentry.getRootSpan(active) : undefined;

  const endOpenSpans = () => {
    const open = rootSpan ? openSpansByRoot.get(rootSpan) : undefined;
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

  if (!signal) {
    return fn();
  }

  // An already-aborted signal never emits, so that case is handled in the finally below.
  if (!signal.aborted) {
    signal.addEventListener('abort', endOpenSpans, { once: true });
  }

  try {
    return await fn();
  } finally {
    signal.removeEventListener('abort', endOpenSpans);
    if (signal.aborted) {
      endOpenSpans();
    }
  }
}
