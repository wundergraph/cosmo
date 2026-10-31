import { Code, ConnectError } from '@connectrpc/connect';
import type { Ora } from 'ora';
import pc from 'picocolors';

// How the client reports a request that got no response from the control plane: 502/503/504 from a proxy become
// Unavailable, a dropped connection becomes Aborted and a client timeout becomes DeadlineExceeded.
const unknownOutcomeCodes = new Set([Code.Unavailable, Code.Aborted, Code.DeadlineExceeded]);

/**
 * Whether a publish failed without a response from the control plane. The control plane may still have stored the
 * schema, with or without composing it.
 */
export function isUnknownPublishOutcome(error: unknown): error is ConnectError {
  return error instanceof ConnectError && unknownOutcomeCodes.has(error.code);
}

export function unknownPublishOutcomeMessage(error: ConnectError): string {
  return [
    `The publish request failed before the control plane responded (${error.rawMessage}).`,
    'The schema may or may not have been stored and composed.',
    'Check in Studio whether a new composition was created for the affected federated graphs.',
    'If it was not, publish again. An identical schema is recomposed when the latest composition does not include it.',
  ].join('\n');
}

/**
 * Runs a publish request. When it fails without a response from the control plane, fails the spinner, explains how to
 * recover and returns undefined. Any other error is rethrown.
 */
export async function publishOrReportUnknownOutcome<T>(
  spinner: Ora,
  failText: string,
  publish: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await publish();
  } catch (error) {
    if (!isUnknownPublishOutcome(error)) {
      throw error;
    }

    spinner.fail(failText);
    console.error(pc.yellow(unknownPublishOutcomeMessage(error)));
    process.exitCode = 1;
    return undefined;
  }
}
