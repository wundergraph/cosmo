import * as Sentry from '@sentry/node';

// eslint-disable-next-line @typescript-eslint/ban-types
function wrapMethod(className: string, key: string, original: Function) {
  return function (this: any, ...args: any[]) {
    return Sentry.startSpan({ name: `${className}.${key}` }, () => original.apply(this, args));
  };
}

/**
 * Class decorator that wraps all methods with Sentry spans.
 * Every method call creates a child span named "ClassName.methodName"
 * under the active transaction.
 *
 * Handles both prototype methods and arrow-function class fields.
 * When Sentry is disabled, startSpan is a no-op passthrough.
 */
export function traced<T extends new (...args: any[]) => any>(target: T): T {
  const className = target.name;
  const proto = target.prototype;

  // Wrap prototype methods
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (!descriptor || typeof descriptor.value !== 'function') {
      continue;
    }
    proto[key] = wrapMethod(className, key, descriptor.value);
  }

  // Wrap arrow-function class fields by extending the class.
  // Arrow functions are assigned as instance properties in the constructor, not on the prototype.
  const wrapped = class extends target {
    constructor(...args: any[]) {
      super(...args);
      for (const key of Object.getOwnPropertyNames(this)) {
        const value = (this as any)[key];
        if (typeof value === 'function') {
          (this as any)[key] = wrapMethod(className, key, value);
        }
      }
    }
  };

  // Preserve the original class name
  Object.defineProperty(wrapped, 'name', { value: className });

  return wrapped as T;
}

/**
 * Wraps a function call with a Sentry span.
 * Use for ad-hoc tracing of service calls, auth, etc.
 */
export function withSpan<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  return Sentry.startSpan({ name }, () => fn()) as Promise<T>;
}
