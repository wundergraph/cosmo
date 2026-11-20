/**
 * Why a command did not succeed. Each kind has one exit code and the error code used when the
 * failure names none, so scripts and agents can branch on the exit code alone.
 */
export const failureKinds = {
  failed: { exitCode: 1, code: 'COMMAND_FAILED' },
  usage: { exitCode: 2, code: 'USAGE_ERROR' },
  findings: { exitCode: 3, code: 'CHECK_FAILED' },
  unauthenticated: { exitCode: 4, code: 'NOT_LOGGED_IN' },
  confirmation: { exitCode: 5, code: 'CONFIRMATION_REQUIRED' },
  interrupted: { exitCode: 130, code: 'INTERRUPTED' },
} as const;

export type FailureKind = keyof typeof failureKinds;

export const exitCodeOf = (kind: FailureKind): number => failureKinds[kind].exitCode;
