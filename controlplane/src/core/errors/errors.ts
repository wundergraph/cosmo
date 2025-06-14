import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { CompositionError } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';

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

export class AuthorizationError extends ServiceError {}

export class UnauthorizedError extends AuthorizationError {
  constructor() {
    super(EnumStatusCode.ERROR_NOT_AUTHORIZED, 'The user does not have the permissions to perform this operation');
  }
}

export function isAuthenticationError(e: Error): e is AuthenticationError {
  return e instanceof AuthenticationError;
}

export function isPublicError(e: Error): e is PublicError {
  return e instanceof PublicError;
}

export function isAuthorizationError(e: Error): e is AuthorizationError {
  return e instanceof AuthorizationError || e instanceof UnauthorizedError;
}

export function unsuccessfulBaseCompositionError(federatedGraphName: string, namespace = 'default'): CompositionError {
  return new CompositionError({
    message:
      `The base composition for the latest publish to the federated graph "${federatedGraphName}" was unsuccessful.` +
      ` Consequently, all related potential compositions (feature flags and contracts) will be ignored.` +
      ` Once a subsequent publish produces a successful federated graph base composition, those aforementioned` +
      ` related compositions will be composed.`,
    federatedGraphName,
    featureFlag: '',
    namespace,
  });
}
