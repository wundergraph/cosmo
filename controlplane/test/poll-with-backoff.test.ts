import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { computeDelay, pollWithBackoff } from '../src/core/util/poll-with-backoff.js';

describe('computeDelay', () => {
  test('returns base when attempt is 0', () => {
    expect(computeDelay(1000, 60_000, 0, false)).toBe(1000);
  });

  test('doubles on each attempt', () => {
    expect(computeDelay(1000, 60_000, 1, false)).toBe(2000);
    expect(computeDelay(1000, 60_000, 2, false)).toBe(4000);
    expect(computeDelay(1000, 60_000, 3, false)).toBe(8000);
    expect(computeDelay(1000, 60_000, 4, false)).toBe(16_000);
  });

  test('caps at maxInterval', () => {
    expect(computeDelay(1000, 5000, 10, false)).toBe(5000);
    expect(computeDelay(1000, 5000, 100, false)).toBe(5000);
  });

  test('jittered delay stays within [50%, 100%] of computed value', () => {
    for (let i = 0; i < 100; i++) {
      const jittered = computeDelay(1000, 60_000, 2, true);
      expect(jittered).toBeGreaterThanOrEqual(2000);
      expect(jittered).toBeLessThanOrEqual(4000);
    }
  });
});

describe('pollWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('polls at base interval on repeated success', async () => {
    const controller = new AbortController();
    const task = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    const polling = pollWithBackoff(task, {
      baseInterval: 1000,
      maxInterval: 60_000,
      signal: controller.signal,
      onSuccess,
      onFailure,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenCalledTimes(2);

    expect(onFailure).not.toHaveBeenCalled();

    controller.abort();
    await polling;
  });

  test('backs off exponentially on consecutive failures', async () => {
    const controller = new AbortController();
    const task = vi.fn().mockRejectedValue(new Error('boom'));
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    const polling = pollWithBackoff(task, {
      baseInterval: 1000,
      maxInterval: 60_000,
      signal: controller.signal,
      onSuccess,
      onFailure,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenLastCalledWith(expect.any(Error), 1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenLastCalledWith(expect.any(Error), 2);

    await vi.advanceTimersByTimeAsync(4000);
    expect(task).toHaveBeenCalledTimes(3);
    expect(onFailure).toHaveBeenLastCalledWith(expect.any(Error), 3);

    controller.abort();
    await polling;
  });

  test('caps delay at maxInterval after many failures', async () => {
    const controller = new AbortController();
    const task = vi.fn().mockRejectedValue(new Error('boom'));

    const polling = pollWithBackoff(task, {
      baseInterval: 1000,
      maxInterval: 3000,
      signal: controller.signal,
      onSuccess: () => {},
      onFailure: () => {},
    });

    await vi.advanceTimersByTimeAsync(1000); // attempt 1, delay was 1000
    await vi.advanceTimersByTimeAsync(2000); // attempt 2, delay was 2000
    await vi.advanceTimersByTimeAsync(3000); // attempt 3, delay capped to 3000
    await vi.advanceTimersByTimeAsync(3000); // attempt 4, still capped
    expect(task).toHaveBeenCalledTimes(4);

    controller.abort();
    await polling;
  });

  test('resets attempt counter after a successful poll', async () => {
    const controller = new AbortController();
    const outcomes = [false, false, true, false];
    let index = 0;
    const task = vi.fn().mockImplementation(() => {
      const ok = outcomes[index++];
      return ok ? Promise.resolve() : Promise.reject(new Error('fail'));
    });
    const onSuccess = vi.fn();
    const onFailure = vi.fn();

    const polling = pollWithBackoff(task, {
      baseInterval: 1000,
      maxInterval: 60_000,
      signal: controller.signal,
      onSuccess,
      onFailure,
    });

    await vi.advanceTimersByTimeAsync(1000); // fail 1
    await vi.advanceTimersByTimeAsync(2000); // fail 2
    await vi.advanceTimersByTimeAsync(4000); // success — resets attempt
    await vi.advanceTimersByTimeAsync(1000); // fail 1 again

    expect(onFailure).toHaveBeenNthCalledWith(1, expect.any(Error), 1);
    expect(onFailure).toHaveBeenNthCalledWith(2, expect.any(Error), 2);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenNthCalledWith(3, expect.any(Error), 1);

    controller.abort();
    await polling;
  });

  test('stops polling once the signal aborts', async () => {
    const controller = new AbortController();
    const task = vi.fn().mockResolvedValue(undefined);

    const polling = pollWithBackoff(task, {
      baseInterval: 1000,
      maxInterval: 60_000,
      signal: controller.signal,
      onSuccess: () => {},
      onFailure: () => {},
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1);

    controller.abort();
    await polling;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  test('passes the signal through to the task', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const task = vi.fn().mockImplementation((signal: AbortSignal) => {
      receivedSignal = signal;
      return Promise.resolve();
    });

    const polling = pollWithBackoff(task, {
      baseInterval: 1000,
      maxInterval: 60_000,
      signal: controller.signal,
      onSuccess: () => {},
      onFailure: () => {},
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(receivedSignal).toBe(controller.signal);

    controller.abort();
    await polling;
  });

  test('normalizes non-Error throws to Error', async () => {
    const controller = new AbortController();
    const task = vi.fn().mockImplementation(() =>
      // eslint-disable-next-line prefer-promise-reject-errors
      Promise.reject('string thrown'),
    );
    const onFailure = vi.fn();

    const polling = pollWithBackoff(task, {
      baseInterval: 1000,
      maxInterval: 60_000,
      signal: controller.signal,
      onSuccess: () => {},
      onFailure,
    });

    await vi.advanceTimersByTimeAsync(1000);
    const [errArg] = onFailure.mock.calls[0];
    expect(errArg).toBeInstanceOf(Error);
    expect(errArg.message).toBe('string thrown');

    controller.abort();
    await polling;
  });

  test('runs the first poll immediately when leading is true', async () => {
    const controller = new AbortController();
    const task = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();

    const polling = pollWithBackoff(task, {
      baseInterval: 1000,
      maxInterval: 60_000,
      signal: controller.signal,
      onSuccess,
      onFailure: () => {},
      leading: true,
    });

    // Yield one microtask for the leading task to run.
    await Promise.resolve();
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);

    // Subsequent ticks follow the normal sleep-then-task order.
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);

    controller.abort();
    await polling;
  });

  test('waits for the first interval when leading is false or omitted', async () => {
    const controller = new AbortController();
    const task = vi.fn().mockResolvedValue(undefined);

    const polling = pollWithBackoff(task, {
      baseInterval: 1000,
      maxInterval: 60_000,
      signal: controller.signal,
      onSuccess: () => {},
      onFailure: () => {},
    });

    // No leading run — task should not have been called yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(task).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(1);

    controller.abort();
    await polling;
  });

  test('returns immediately if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const task = vi.fn();

    await pollWithBackoff(task, {
      baseInterval: 1000,
      maxInterval: 60_000,
      signal: controller.signal,
      onSuccess: () => {},
      onFailure: () => {},
    });

    expect(task).not.toHaveBeenCalled();
  });
});
