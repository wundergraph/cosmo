import * as Sentry from '@sentry/node';

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
export function withSpan<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  return Sentry.startSpan({ name }, () => fn()) as Promise<T>;
}
