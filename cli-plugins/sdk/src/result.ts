import type { Failure } from './output.js';

export type Result<T> = { success: true; data: T } | { success: false; errors: Error[] };

export const ok = <T>(data: T): Result<T> => ({ success: true, data });

export const failure = <T>(message: string, cause?: Error): Result<T> => ({
  success: false,
  errors: [new Error(message, cause ? { cause } : undefined)],
});

/** An error that carries everything `Output.fail` prints: its kind, code, remediation and fix. */
export class CliError extends Error {
  readonly failure: Failure;

  constructor(failure: Failure) {
    super(failure.message);
    this.name = 'CliError';
    this.failure = failure;
  }
}

export const failWith = <T>(described: Failure): Result<T> => ({
  success: false,
  errors: [new CliError(described)],
});

export const errorMessage = (result: { success: false; errors: Error[] }): string =>
  result.errors.map((error) => error.message).join('; ');

/** The failure to print for a failed result: the first error's own description, or the joined messages. */
export const toFailure = (result: { success: false; errors: Error[] }): Failure => {
  const [first] = result.errors;
  if (first instanceof CliError) {
    return first.failure;
  }
  return { message: errorMessage(result) };
};
