export type Result<T> = { success: true; data: T } | { success: false; errors: Error[] };

export const ok = <T>(data: T): Result<T> => ({ success: true, data });

export const failure = <T>(message: string, cause?: Error): Result<T> => ({
  success: false,
  errors: [new Error(message, cause ? { cause } : undefined)],
});

export const errorMessage = (result: { success: false; errors: Error[] }): string =>
  result.errors.map((error) => error.message).join('; ');
