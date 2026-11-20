import { hubFailureKind, ok } from '@wundergraph/wgc-plugin-sdk';
import type { Failure, HubClient, Output, Result } from '@wundergraph/wgc-plugin-sdk';
import { hubResults, hubTools } from './contract.js';
import type { Operation, OperationStatus, OperationStep, StepStatus } from './contract.js';
import type { HubRuntime } from './runtime.js';

const finishedStatuses = new Set<OperationStatus>(['succeeded', 'failed', 'cancelled']);

const waitingStatuses = new Set<OperationStatus>(['needs_approval', 'needs_input']);

const settledStepStatuses = new Set<StepStatus>(['succeeded', 'failed', 'skipped']);

const stepMarks: Record<StepStatus, string> = {
  running: ' ',
  succeeded: '✓',
  failed: '✗',
  skipped: '·',
};

/** How long to wait between two `get_operation` calls while following an operation. */
const pollDelayMs = 1000;

export const isFinished = (operation: { status: OperationStatus }): boolean => finishedStatuses.has(operation.status);

/** `38ms` under a tenth of a second, `0.2s` and `10.0s` above, so short collection operations keep their precision. */
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
  if (step.status === 'failed') {
    return step.detail;
  }
  return '';
};

/** The name column fits every row, so outcomes line up while rows stream in. */
export const nameColumnWidth = (names: string[]): number => Math.max(20, ...names.map((name) => name.length + 1));

/** `  ✓ AddToCart           38ms`: one step of an operation or one operation of a collection. */
export const renderRow = (mark: string, name: string, width: number, outcome: string): string =>
  `  ${mark} ${name.padEnd(width)}${outcome}`.trimEnd();

const summarizeOperation = (operation: Operation): string => `${operation.kind} ${operation.status}  ${operation.id}`;

/** `launch_sandbox` reads as `launch sandbox` in sentences. */
const describeKind = (kind: string): string => kind.replaceAll('_', ' ');

/** Prints each step once it settles, in text or as JSON lines on stderr. */
const createStepPrinter = (output: Output) => {
  const printedSteps = new Set<number>();

  return {
    show(operation: Operation): void {
      const width = nameColumnWidth(operation.steps.map((step) => step.name));
      for (const [index, step] of operation.steps.entries()) {
        if (printedSteps.has(index) || !settledStepStatuses.has(step.status)) {
          continue;
        }

        printedSteps.add(index);
        output.message(renderRow(stepMarks[step.status], step.name, width, stepOutcome(step)), {
          event: 'step',
          operation: operation.id,
          name: step.name,
          status: step.status,
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
  | { kind: 'waiting'; operation: Operation }
  | { kind: 'detached'; operation: Operation }
  | { kind: 'timed-out'; operation: Operation };

/** Reads an operation once, e.g. to start following it. */
export const fetchOperation = (hub: HubClient, operationId: string, signal?: AbortSignal) =>
  hub.callTool(hubTools.getOperation, { operationId }, hubResults.getOperation, { signal });

/**
 * Follows an operation until it finishes, waits on a person, passes `deadline`, or the user presses
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
      if (waitingStatuses.has(current.status)) {
        printer.finish();
        return ok({ kind: 'waiting', operation: current });
      }
      if (deadline && runtime.now() >= deadline) {
        return ok({ kind: 'timed-out', operation: current });
      }

      await runtime.sleep(pollDelayMs);
      const polled = await fetchOperation(hub, current.id, abort.signal);
      if (abort.signal.aborted) {
        printer.finish();
        return ok({ kind: 'detached', operation: current });
      }
      if (!polled.success) {
        return polled;
      }

      current = polled.data;
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
    remediation: operation.error.remediation ?? undefined,
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

/** Reports an operation that did not finish while followed: detached, waiting on a person, or past the wait. */
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

  if (kind === 'waiting') {
    const approval = operation.status === 'needs_approval';
    output.fail({
      kind: 'confirmation',
      code: 'CONFIRMATION_REQUIRED',
      message: operation.approvalReason ?? `${operation.id} is waiting for ${approval ? 'approval' : 'its requester'}.`,
      remediation: `${approval ? 'Approve' : 'Answer'} it in Hub:\n${operation.url}`,
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

/** Reports a finished operation: its summary on success, its error on failure. */
export const reportFinished = (output: Output, operation: Operation): void => {
  if (operation.status === 'succeeded') {
    output.result({ operation }, (data) => summarizeOperation(data.operation), {
      operation: { id: operation.id, status: operation.status },
      url: operation.url,
    });
    return;
  }

  output.fail({ ...operationFailure(operation), data: { operation } });
};
