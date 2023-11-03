import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';

export class ServiceError extends Error {
  constructor(
    public code: EnumStatusCode,
    message: string,
    cause?: Error,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
    this.code = code;
  }
}

export class PublicError extends ServiceError {}

export class AuthenticationError extends ServiceError {}

export class FreeTrialExpiredError extends ServiceError {}

export function isAuthenticationError(e: Error): e is AuthenticationError {
  return e instanceof AuthenticationError;
}

export function isPublicError(e: Error): e is PublicError {
  return e instanceof PublicError;
}

export function isFreeTrialExpiredError(e: Error): e is FreeTrialExpiredError {
  return e instanceof FreeTrialExpiredError;
}
