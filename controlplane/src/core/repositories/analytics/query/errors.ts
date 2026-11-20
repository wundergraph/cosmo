/**
 * Errors the caller of an analytics query can fix. Handlers turn each into ERR_BAD_REQUEST with its message; they stay
 * free of protocol types so the query layer can be tested without a server.
 */

/** The request names an unknown dataset, field or operator, or asks for an impossible window. */
export class QueryValidationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause instanceof Error ? { cause } : undefined);
    this.name = 'QueryValidationError';
    Object.setPrototypeOf(this, QueryValidationError.prototype);
  }
}

/** The request passed validation but can't be compiled to SQL. */
export class QueryCompileError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause instanceof Error ? { cause } : undefined);
    this.name = 'QueryCompileError';
    Object.setPrototypeOf(this, QueryCompileError.prototype);
  }
}

/** The query would read more rows than the row budget allows. */
export class QueryBudgetError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause instanceof Error ? { cause } : undefined);
    this.name = 'QueryBudgetError';
    Object.setPrototypeOf(this, QueryBudgetError.prototype);
  }
}
