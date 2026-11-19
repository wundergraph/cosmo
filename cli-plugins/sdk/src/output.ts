import pc from 'picocolors';

export interface Writable {
  write(chunk: string): unknown;
}

/** A failure the caller can act on: what went wrong, which input caused it, and how to correct it. */
export interface Failure {
  message: string;
  input?: string;
  fix?: string;
  /** Structured context for JSON callers, such as the evidence behind a failed check. */
  details?: object;
}

/** One step of a long operation, e.g. `{ step: 'compile', subject: 'router', message: 'Compiling router' }`. */
export interface ProgressEvent {
  step: string;
  message: string;
  subject?: string;
}

export interface Output {
  readonly json: boolean;
  /**
   * Reports one step of a long operation. People see a line on stderr; JSON callers get an NDJSON
   * `{"event":"progress",…}` line on stderr, so stdout carries only the final result.
   */
  progress(event: ProgressEvent): void;
  /** Prints the outcome: JSON for machines, the rendered text for people. */
  result<T extends object>(data: T, render: (data: T) => string): void;
  /** Prints the failure in the caller's format and sets a non-zero exit code. */
  fail(failure: Failure): void;
}

export const createOutput = ({
  json,
  stdout = process.stdout,
  stderr = process.stderr,
}: {
  json: boolean;
  stdout?: Writable;
  stderr?: Writable;
}): Output => ({
  json,
  progress(event) {
    if (json) {
      stderr.write(`${JSON.stringify({ event: 'progress', ...event })}\n`);
      return;
    }
    const subject = event.subject ? `${pc.cyan(event.subject)} ` : '';
    stderr.write(`${pc.dim('›')} ${subject}${event.message}\n`);
  },
  result(data, render) {
    if (json) {
      stdout.write(`${JSON.stringify({ status: 'success', ...data })}\n`);
      return;
    }
    stdout.write(`${render(data)}\n`);
  },
  fail(failure) {
    process.exitCode = 1;
    if (json) {
      stdout.write(`${JSON.stringify({ status: 'error', error: failure })}\n`);
      return;
    }
    const lines = [pc.red(failure.message)];
    if (failure.input) {
      lines.push(`  input: ${failure.input}`);
    }
    if (failure.fix) {
      lines.push(`  fix: ${failure.fix}`);
    }
    stderr.write(`${lines.join('\n')}\n`);
  },
});
