import * as Sentry from '@sentry/node';

/**
 * Class decorator that wraps all methods with Sentry spans.
 * Every method call creates a child span named "ClassName.methodName"
 * under the active transaction.
 *
 * When Sentry is disabled, startSpan is a no-op passthrough.
 */
export function traced(target: new (...args: any[]) => any) {
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

    const original = descriptor.value;
    proto[key] = function (...args: any[]) {
      return Sentry.startSpan({ name: `${className}.${key}` }, () => original.apply(this, args));
    };
  }
}

/**
 * Wraps a function call with a Sentry span.
 * Use for ad-hoc tracing of service calls, auth, etc.
 */
export function withSpan<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  return Sentry.startSpan({ name }, () => fn()) as Promise<T>;
}
