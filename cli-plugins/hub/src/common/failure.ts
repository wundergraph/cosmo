import type { Output, Result } from '@wundergraph/wgc-plugin-sdk';

/** An error that names the input that caused it and how the caller corrects it. */
export class ActionableError extends Error {
  constructor(
    message: string,
    readonly fix?: string,
    readonly input?: string,
  ) {
    super(message);
  }
}

export const actionable = <T>(message: string, fix?: string, input?: string): Result<T> => ({
  success: false,
  errors: [new ActionableError(message, fix, input)],
});

export const reportFailure = (output: Output, errors: Error[]): void => {
  const [first] = errors;
  const message = errors.map((error) => error.message).join('\n');
  if (first instanceof ActionableError) {
    output.fail({ message, fix: first.fix, input: first.input });
    return;
  }
  output.fail({ message });
};
