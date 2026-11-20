import pc from 'picocolors';
import { exitCodeOf, failureKinds } from './exit.js';
import type { FailureKind } from './exit.js';

export interface Writable {
  write(chunk: string): unknown;
}

/** A command to run next, e.g. `{ command: 'wgc hub open', description: 'open the sandbox in Hub' }`. */
export interface NextStep {
  command: string;
  description: string;
}

/** A failure the caller can act on: what went wrong, which input caused it, and how to correct it. */
export interface Failure {
  message: string;
  /** Picks the exit code. Defaults to `failed`. */
  kind?: FailureKind;
  /** Stable SCREAMING_SNAKE code shared with Hub's UI and MCP. Defaults to the kind's code. */
  code?: string;
  remediation?: string;
  /** Commands that fix the failure, most likely first. */
  next?: string[];
  input?: string;
  docs?: string;
  /** The Hub page of the operation or object that failed. */
  url?: string;
  /** What the command found despite failing, such as a check report. */
  data?: object;
}

/** One step of a long operation, e.g. `{ step: 'compile', subject: 'router', message: 'Compiling router' }`. */
export interface ProgressEvent {
  step: string;
  message: string;
  subject?: string;
}

export interface ResultOptions {
  /** False when a write found nothing to change. */
  changed?: boolean;
  operation?: { id: string; status: string };
  url?: string;
  next?: NextStep[];
}

/** A JSON line for stderr, e.g. `{ event: 'operation', id: 'op_1', url: '…' }`. */
export type OutputEvent = { event: string } & Record<string, string | number | boolean | null>;

export interface Output {
  readonly json: boolean;
  /**
   * Reports one step of a long operation. People see a line on stderr; JSON callers get an NDJSON
   * `{"event":"progress",…}` line on stderr, so stdout carries only the final result.
   */
  progress(event: ProgressEvent): void;
  /** A line for people on stderr. JSON callers get `event` instead, or nothing without one. */
  message(text: string, event?: OutputEvent): void;
  /** One record of a streamed result, such as a followed log line: text for people, a JSON line for machines. */
  record(text: string, event: OutputEvent): void;
  /** Prints the outcome on stdout: the JSON envelope for machines, the rendered text for people. */
  result<T extends object>(data: T, render: (data: T) => string, options?: ResultOptions): void;
  /**
   * Prints the failure and sets the exit code of its kind. With `render` and `data`, people see the
   * rendered data on stdout in place of the error block, because the rendering already shows what failed.
   */
  fail<T extends object>(failure: Failure & { data?: T }, render?: (data: T) => string): void;
}

const indent = (text: string): string =>
  text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

const renderNext = (next: NextStep[]): string => {
  const width = Math.max(...next.map((step) => step.command.length)) + 6;
  return ['Next', ...next.map((step) => `  ${step.command.padEnd(width)}${step.description}`)].join('\n');
};

const renderFailure = (failure: Failure, code: string): string => {
  if (failure.kind === 'usage') {
    return [`${pc.red('error:')} ${failure.message}`, failure.remediation].filter(Boolean).join('\n');
  }

  const lines = [`${pc.red('error')} ${code}`, indent(failure.message)];
  if (failure.remediation) {
    lines.push(indent(failure.remediation));
  }

  const references: string[] = [];
  if (failure.input) {
    references.push(`  Input ${failure.input}`);
  }
  if (failure.next && failure.next.length > 0) {
    references.push(`  Fix   ${failure.next[0]}`);
  }
  if (failure.docs) {
    references.push(`  Docs  ${failure.docs}`);
  }
  if (references.length > 0) {
    lines.push('', ...references);
  }

  return lines.join('\n');
};

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

  message(text, event) {
    if (!json) {
      stderr.write(`${text}\n`);
      return;
    }

    if (event) {
      stderr.write(`${JSON.stringify(event)}\n`);
    }
  },

  record(text, event) {
    stdout.write(`${json ? JSON.stringify(event) : text}\n`);
  },

  result(data, render, options = {}) {
    if (json) {
      const envelope = {
        ok: true,
        changed: options.changed,
        operation: options.operation,
        data,
        url: options.url,
        next: options.next?.map((step) => step.command),
      };
      stdout.write(`${JSON.stringify(envelope)}\n`);
      return;
    }

    const blocks = [render(data)];
    if (options.next && options.next.length > 0) {
      blocks.push(renderNext(options.next));
    }
    stdout.write(`${blocks.filter((block) => block !== '').join('\n\n')}\n`);
  },

  fail(failure, render) {
    const kind = failure.kind ?? 'failed';
    const code = failure.code ?? failureKinds[kind].code;
    process.exitCode = exitCodeOf(kind);

    if (json) {
      const envelope = {
        ok: false,
        error: {
          code,
          message: failure.message,
          remediation: failure.remediation,
          next: failure.next,
          input: failure.input,
          docs: failure.docs,
        },
        data: failure.data,
        url: failure.url,
      };
      stdout.write(`${JSON.stringify(envelope)}\n`);
      return;
    }

    if (render && failure.data) {
      stdout.write(`${render(failure.data)}\n`);
      return;
    }

    stderr.write(`${renderFailure({ ...failure, kind }, code)}\n`);
  },
});
