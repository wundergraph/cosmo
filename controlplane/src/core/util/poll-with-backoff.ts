export interface PollWithBackoffOptions {
  baseInterval: number;
  maxInterval: number;
  signal: AbortSignal;
  onSuccess: () => void;
  onFailure: (error: Error, attempt: number) => void;
  jitter?: boolean;
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

  while (!options.signal.aborted) {
    const delay = computeDelay(options.baseInterval, options.maxInterval, attempt, options.jitter ?? false);

    const sleepResult = await sleep(delay, options.signal);
    if (sleepResult === 'aborted') {
      return;
    }

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
