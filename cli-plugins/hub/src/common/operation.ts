import { hubFailureKind, ok } from '@wundergraph/wgc-plugin-sdk';
import type { Failure, HubClient, Output, Result } from '@wundergraph/wgc-plugin-sdk';
import { hubResults, hubTools, longPollSeconds } from './contract.js';
import type { Operation, OperationStatus, OperationStep, StepStatus } from './contract.js';
import type { HubRuntime } from './runtime.js';

const finishedStatuses = new Set<OperationStatus>(['succeeded', 'failed', 'cancelled']);

const settledStepStatuses = new Set<StepStatus>(['succeeded', 'failed', 'skipped', 'cancelled']);

const stepMarks: Record<StepStatus, string> = {
  pending: ' ',
  running: ' ',
  succeeded: '✓',
  failed: '✗',
  skipped: '·',
  cancelled: '·',
};

/** How long to wait before asking again when Hub answered a long poll without news. */
const quietPollDelayMs = 1000;

export const isFinished = (operation: Operation): boolean => finishedStatuses.has(operation.status);

/** `38ms` under a tenth of a second, `0.2s` and `10.0s` above, so short collection steps keep their precision. */
export const formatDuration = (milliseconds: number): string => {
  if (milliseconds < 100) {
    return `${milliseconds}ms`;
  }
  return `${(milliseconds / 1000).toFixed(1)}s`;
};

const stepOutcome = (step: OperationStep): string => {
  if (step.status === 'skipped') {
    return step.detail ? `skipped (${step.detail})` : 'skipped';
  }
  if (step.status === 'cancelled') {
    return 'cancelled';
  }
  if (step.status === 'failed' && step.detail) {
    return step.detail;
  }
  if (step.durationMs === null) {
    return '';
  }
  return formatDuration(step.durationMs);
};

/** The name column fits every step of the operation, so durations line up while steps stream in. */
const stepColumnWidth = (steps: OperationStep[]): number => Math.max(20, ...steps.map((step) => step.name.length + 1));

export const renderStep = (step: OperationStep, width: number): string =>
  `  ${stepMarks[step.status]} ${step.name.padEnd(width)}${stepOutcome(step)}`.trimEnd();

/** `2 passed, 1 failed, 1 skipped` for a collection run; zero failed and skipped counts are left out. */
const collectionTally = (operation: Operation): string => {
  const count = (status: StepStatus) => operation.steps.filter((step) => step.status === status).length;
  const parts = [`${count('succeeded')} passed`];
  if (count('failed') > 0) {
    parts.push(`${count('failed')} failed`);
  }
  if (count('skipped') > 0) {
    parts.push(`${count('skipped')} skipped`);
  }
  return parts.join(', ');
};

/** Operation kinds whose outcome reads better as their own summary than as an error block. */
const summaries: Record<string, (operation: Operation) => string> = {
  'collection.run': collectionTally,
};

export const summarizeOperation = (operation: Operation): string => {
  const summary = summaries[operation.kind];
  if (summary) {
    return summary(operation);
  }
  return `${operation.kind} ${operation.status}  ${operation.id}`;
};

/** `sandbox.launch` reads as `sandbox launch` in sentences. */
export const describeKind = (kind: string): string => kind.replaceAll('.', ' ');

/** What a detached command prints: the operation, its Hub page and how to follow it. */
export const renderStarted = (operation: Operation, extraLines: string[] = []): string =>
  [
    `Started ${describeKind(operation.kind)} ${operation.id}`,
    `  ${operation.url}`,
    `Watch   wgc hub operation watch ${operation.id}`,
    ...extraLines,
  ].join('\n');

/** Prints each step once it settles and each event once, in text or as JSON lines on stderr. */
const createStepPrinter = (output: Output) => {
  const printedSteps = new Set<number>();
  let printedEvents = 0;

  return {
    show(operation: Operation): void {
      for (const event of operation.events.slice(printedEvents)) {
        output.message(`    ${event.message}`, {
          event: 'operation_event',
          operation: operation.id,
          at: event.at,
          step: event.step,
          message: event.message,
        });
      }
      printedEvents = operation.events.length;

      const width = stepColumnWidth(operation.steps);
      for (const [index, step] of operation.steps.entries()) {
        if (printedSteps.has(index) || !settledStepStatuses.has(step.status)) {
          continue;
        }

        printedSteps.add(index);
        output.message(renderStep(step, width), {
          event: 'step',
          operation: operation.id,
          name: step.name,
          status: step.status,
          duration_ms: step.durationMs,
          detail: step.detail,
        });
      }
    },

    /** Separates the step list from what follows it. */
    finish(): void {
      if (printedSteps.size > 0) {
        output.message('');
      }
    },
  };
};

export type FollowOutcome =
  | { kind: 'finished'; operation: Operation }
  | { kind: 'input-required'; operation: Operation }
  | { kind: 'detached'; operation: Operation }
  | { kind: 'timed-out'; operation: Operation };

const sameProgress = (before: Operation, after: Operation): boolean =>
  before.status === after.status &&
  before.events.length === after.events.length &&
  JSON.stringify(before.steps) === JSON.stringify(after.steps);

/**
 * Follows an operation until it finishes, needs approval, passes `deadline`, or the user presses
 * Ctrl-C. Ctrl-C only detaches: the operation keeps running in Hub.
 */
export const followOperation = async ({
  hub,
  output,
  runtime,
  operation,
  showSteps = true,
  deadline,
}: {
  hub: HubClient;
  output: Output;
  runtime: HubRuntime;
  operation: Operation;
  showSteps?: boolean;
  deadline?: Date;
}): Promise<Result<FollowOutcome>> => {
  const printer = createStepPrinter(output);
  const show = (current: Operation) => {
    if (showSteps) {
      printer.show(current);
    }
  };

  const abort = new AbortController();
  const stopListening = runtime.onInterrupt(() => abort.abort());

  try {
    let current = operation;
    show(current);

    while (true) {
      if (isFinished(current)) {
        printer.finish();
        return ok({ kind: 'finished', operation: current });
      }
      if (current.status === 'input_required') {
        printer.finish();
        return ok({ kind: 'input-required', operation: current });
      }
      if (deadline && runtime.now() >= deadline) {
        return ok({ kind: 'timed-out', operation: current });
      }

      const polled = await hub.callTool(
        hubTools.getOperation,
        { operation_id: current.id, wait_seconds: longPollSeconds },
        hubResults.getOperation,
        { signal: abort.signal },
      );
      if (abort.signal.aborted) {
        printer.finish();
        return ok({ kind: 'detached', operation: current });
      }
      if (!polled.success) {
        return polled;
      }

      const next = polled.data.operation;
      if (sameProgress(current, next)) {
        await runtime.sleep(quietPollDelayMs);
      }

      current = next;
      show(current);
    }
  } finally {
    stopListening();
  }
};

/** The failure to print for an operation that failed or was cancelled in Hub. */
export const operationFailure = (operation: Operation): Failure => {
  if (operation.status === 'cancelled') {
    return { code: 'OPERATION_CANCELLED', message: `${operation.id} was cancelled.`, url: operation.url };
  }

  if (operation.error === null) {
    return { message: `${describeKind(operation.kind)} ${operation.id} failed.`, url: operation.url };
  }

  return {
    kind: hubFailureKind(operation.error.code),
    code: operation.error.code,
    message: operation.error.message,
    remediation: operation.error.remediation,
    next: operation.error.fix ? [operation.error.fix] : undefined,
    docs: operation.error.docs,
    url: operation.url,
  };
};

const watchCommand = (operation: Operation) => `wgc hub operation watch ${operation.id}`;

const renderDetached = (data: { operation: { id: string } }): string =>
  [
    `Detached from ${data.operation.id}. It keeps running in Hub.`,
    `Watch   wgc hub operation watch ${data.operation.id}`,
    `Cancel  wgc hub operation cancel ${data.operation.id}`,
  ].join('\n');

/** Reports an operation that did not finish while followed: detached, waiting for approval, or past the wait. */
export const reportUnfinished = (
  output: Output,
  outcome: Exclude<FollowOutcome, { kind: 'finished' }>,
  timeout?: string,
): void => {
  const { kind, operation } = outcome;

  if (kind === 'detached') {
    output.fail(
      {
        kind: 'interrupted',
        code: 'DETACHED',
        message: `Detached from ${operation.id}. It keeps running in Hub.`,
        next: [watchCommand(operation), `wgc hub operation cancel ${operation.id}`],
        url: operation.url,
        data: { operation: { id: operation.id, status: operation.status }, detached: true },
      },
      renderDetached,
    );
    return;
  }

  if (kind === 'input-required') {
    output.fail({
      kind: 'confirmation',
      code: operation.error?.code ?? 'CONFIRMATION_REQUIRED',
      message: operation.error?.message ?? `${operation.id} is waiting for approval.`,
      remediation: `${operation.error?.remediation ?? 'Approve it in Hub:'}\n${operation.url}`,
      next: [watchCommand(operation)],
      url: operation.url,
    });
    return;
  }

  output.fail({
    code: 'WAIT_TIMEOUT',
    message: `${operation.id} is still ${operation.status} after ${timeout ?? 'the timeout'}. It keeps running in Hub.`,
    next: [watchCommand(operation)],
    url: operation.url,
  });
};

/** Reports a finished operation: its summary on success, its error (or its own summary) on failure. */
export const reportFinished = (output: Output, operation: Operation): void => {
  const options = { operation: { id: operation.id, status: operation.status }, url: operation.url };

  if (operation.status === 'succeeded') {
    output.result({ operation }, (data) => summarizeOperation(data.operation), options);
    return;
  }

  const ownSummary = summaries[operation.kind];
  output.fail(
    { ...operationFailure(operation), data: { operation } },
    ownSummary ? (data) => ownSummary(data.operation) : undefined,
  );
};
