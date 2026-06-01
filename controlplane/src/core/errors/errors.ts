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

/**
 * Thrown when a user authenticates via a login method the organization does not
 * allow. Extends AuthenticationError so it surfaces as a not-authenticated
 * failure with a message guiding the user to sign in with an allowed method.
 */
export class LoginMethodNotAllowedError extends AuthenticationError {
  constructor() {
    super(
      EnumStatusCode.ERROR_NOT_AUTHENTICATED,
      'Your login method is not permitted for this organization. Sign in with one of the allowed methods.',
    );
  }
}

export function isAuthenticationError(e: Error): e is AuthenticationError {
  return e instanceof AuthenticationError;
}

export function isPublicError(e: unknown): e is PublicError {
  return e instanceof PublicError;
}

export function isAuthorizationError(e: Error): e is AuthorizationError {
  return e instanceof AuthorizationError || e instanceof UnauthorizedError;
}

/**
 * Thrown when a ClickHouse query fails and the client's healthcheck indicates the server is currently unreachable.
 * Caller-facing signal for "this is an availability issue, not a query bug" — surfaced as Code.Unavailable / HTTP 503.
 * The message intentionally avoids naming ClickHouse so we don't leak implementation details to API consumers.
 */
export class ClickHouseUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Analytical service is currently unavailable', cause instanceof Error ? { cause } : undefined);
    this.name = 'ClickHouseUnavailableError';
    Object.setPrototypeOf(this, ClickHouseUnavailableError.prototype);
  }
}

export function isClickHouseUnavailableError(e: unknown): e is ClickHouseUnavailableError {
  return e instanceof ClickHouseUnavailableError;
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
