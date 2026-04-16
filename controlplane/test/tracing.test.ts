import { describe, expect, test, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/node';
import { traced, withSpan } from '../src/core/tracing.js';

vi.mock('@sentry/node', () => {
  return {
    startSpan: vi.fn((opts: { name: string }, cb: (span: any) => any) => cb({ name: opts.name })),
  };
});

const startSpanMock = vi.mocked(Sentry.startSpan);

beforeEach(() => {
  startSpanMock.mockClear();
});

describe('traced decorator', () => {
  test('wraps prototype methods', () => {
    @traced
    class MyService {
      greet(name: string) {
        return `hello ${name}`;
      }
    }

    const svc = new MyService();
    const result = svc.greet('world');

    expect(result).toBe('hello world');
    expect(startSpanMock).toHaveBeenCalledWith({ name: 'MyService.greet' }, expect.any(Function));
  });

  test('wraps async prototype methods', async () => {
    @traced
    class MyRepo {
      findById(id: string) {
        return Promise.resolve({ id, name: 'test' });
      }
    }

    const repo = new MyRepo();
    const result = await repo.findById('123');

    expect(result).toEqual({ id: '123', name: 'test' });
    expect(startSpanMock).toHaveBeenCalledWith({ name: 'MyRepo.findById' }, expect.any(Function));
  });

  test('preserves this context for prototype methods', () => {
    @traced
    class Counter {
      count = 0;

      increment() {
        this.count += 1;
        return this.count;
      }
    }

    const counter = new Counter();
    expect(counter.increment()).toBe(1);
    expect(counter.increment()).toBe(2);
  });

  test('skips non-function properties', () => {
    @traced
    class Config {
      name = 'test';
      count = 42;

      getValue() {
        return this.name;
      }
    }

    const config = new Config();
    expect(config.name).toBe('test');
    expect(config.count).toBe(42);
    expect(config.getValue()).toBe('test');
    expect(startSpanMock).toHaveBeenCalledTimes(1);
    expect(startSpanMock).toHaveBeenCalledWith({ name: 'Config.getValue' }, expect.any(Function));
  });

  test('preserves class name', () => {
    @traced
    class OriginalName {}

    expect(OriginalName.name).toBe('OriginalName');
  });

  test('works with traced() as a function call', () => {
    class ManualService {
      doWork() {
        return 'done';
      }
    }
    traced(ManualService);

    const svc = new ManualService();
    expect(svc.doWork()).toBe('done');
    expect(startSpanMock).toHaveBeenCalledWith({ name: 'ManualService.doWork' }, expect.any(Function));
  });

  test('does not wrap constructor', () => {
    @traced
    class MyClass {
      value: string;
      constructor() {
        this.value = 'init';
      }
    }

    const obj = new MyClass();
    expect(obj.value).toBe('init');
    const constructorCalls = startSpanMock.mock.calls.filter(([opts]) => opts.name.includes('constructor'));
    expect(constructorCalls).toHaveLength(0);
  });
});

describe('withSpan', () => {
  test('wraps sync function', async () => {
    const result = await withSpan('test-span', () => 42);

    expect(result).toBe(42);
    expect(startSpanMock).toHaveBeenCalledWith({ name: 'test-span' }, expect.any(Function));
  });

  test('wraps async function', async () => {
    const result = await withSpan('async-span', () => Promise.resolve('hello'));

    expect(result).toBe('hello');
    expect(startSpanMock).toHaveBeenCalledWith({ name: 'async-span' }, expect.any(Function));
  });
});
