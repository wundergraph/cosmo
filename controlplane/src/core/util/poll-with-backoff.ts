export interface PollWithBackoffOptions {
  /** Base delay between polls when the task is succeeding, in milliseconds. Used as the starting point for exponential growth on failure. */
  baseInterval: number;
  /** Upper bound on the delay between polls, in milliseconds. The exponential growth is clamped to this value. */
  maxInterval: number;
  /** External signal that stops the poller. When aborted, the loop exits and any in-flight task receives this signal too. */
  signal: AbortSignal;
  /** Called after each successful poll. Runs synchronously inside the loop, so keep it fast and non-throwing. */
  onSuccess: () => void;
  /** Called after each failed poll. `attempt` is the consecutive-failure count starting at 1; it resets to 0 after a success. */
  onFailure: (error: Error, attempt: number) => void;
  /** Multiply each delay by a random factor in [0.5, 1.0] to desynchronize multiple pollers and avoid thundering-herd on recovery. */
  jitter?: boolean;
  /** Run the first poll immediately instead of waiting `baseInterval` first. Useful for health probes that want an answer at startup. */
  leading?: boolean;
}

export function computeDelay(base: number, max: number, attempt: number, jitter: boolean): number {
  const delay = Math.min(max, base * 2 ** attempt);
  return jitter ? delay * (0.5 + Math.random() * 0.5) : delay;
}

export async function pollWithBackoff(
  task: (signal: AbortSignal) => Promise<void>,
  options: PollWithBackoffOptions,
): Promise<void> {
  let attempt = 0;
  let skipNextSleep = options.leading ?? false;

  while (!options.signal.aborted) {
    if (!skipNextSleep) {
      const delay = computeDelay(options.baseInterval, options.maxInterval, attempt, options.jitter ?? false);
      const sleepResult = await sleep(delay, options.signal);
      if (sleepResult === 'aborted') {
        return;
      }
    }
    skipNextSleep = false;

    try {
      await task(options.signal);
      if (options.signal.aborted) {
        return;
      }
      attempt = 0;
      options.onSuccess();
    } catch (caught) {
      if (options.signal.aborted) {
        return;
      }
      attempt++;
      const error = caught instanceof Error ? caught : new Error(String(caught));
      options.onFailure(error, attempt);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<'aborted' | 'ok'> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve('aborted');
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve('ok');
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      resolve('aborted');
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}
