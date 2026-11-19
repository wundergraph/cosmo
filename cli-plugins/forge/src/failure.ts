import type { Failure, Result } from '@wundergraph/wgc-plugin-sdk';

/** An error the caller can act on: it names the input that caused it and how to correct it. */
export class ForgeError extends Error {
  readonly input?: string;
  readonly fix?: string;

  constructor({ message, input, fix }: Failure) {
    super(message);
    this.name = 'ForgeError';
    this.input = input;
    this.fix = fix;
  }
}

export const fail = <T>(failure: Failure): Result<T> => ({ success: false, errors: [new ForgeError(failure)] });

export const toFailure = (result: { success: false; errors: Error[] }): Failure => {
  const [first] = result.errors;
  if (first instanceof ForgeError) {
    return { message: first.message, input: first.input, fix: first.fix };
  }
  return { message: result.errors.map((error) => error.message).join('; ') };
};

/** The last lines of a tool's output, which is where Go and git print what went wrong. */
export const lastLines = (text: string, count = 20): string => text.trim().split('\n').slice(-count).join('\n');
