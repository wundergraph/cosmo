import {
  getOperationAST,
  getVariableValues,
  Kind,
  OperationTypeNode,
  parse,
  validate,
  type GraphQLSchema,
} from 'graphql';

type PreparedAdvisorRequest =
  | {
      ok: true;
      body: Record<string, unknown>;
      operationName?: string;
    }
  | { ok: false; message: string };

const parseVariables = (serializedVariables?: string | null) => {
  if (!serializedVariables?.trim()) {
    return { ok: true as const, variables: {} as Record<string, unknown> };
  }
  let variables: unknown;
  try {
    variables = JSON.parse(serializedVariables);
  } catch {
    return { ok: false as const, message: 'Variables must be valid JSON.' };
  }
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    return { ok: false as const, message: 'Variables must be a JSON object.' };
  }
  return { ok: true as const, variables: variables as Record<string, unknown> };
};

export const prepareDeferAdvisorRequest = ({
  schema,
  query,
  operationName,
  serializedVariables,
}: {
  schema: GraphQLSchema;
  query: string;
  operationName?: string | null;
  serializedVariables?: string | null;
}): PreparedAdvisorRequest => {
  if (!query.trim()) {
    return { ok: false, message: 'Enter a query operation to analyze.' };
  }

  let document;
  try {
    document = parse(query);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `Invalid GraphQL document: ${error.message}` : 'Invalid GraphQL document.',
    };
  }

  const operation = getOperationAST(document, operationName || undefined);
  if (!operation) {
    const operations = document.definitions.filter((definition) => definition.kind === Kind.OPERATION_DEFINITION);
    if (operationName) {
      return { ok: false, message: `Unknown operation "${operationName}".` };
    }
    return {
      ok: false,
      message: operations.length > 1 ? 'Select a query operation to analyze.' : 'Enter a query operation to analyze.',
    };
  }

  const selectedOperationName = operation.name?.value;
  if (operation.operation !== OperationTypeNode.QUERY) {
    const selected = selectedOperationName ? `"${selectedOperationName}"` : 'The selected operation';
    return {
      ok: false,
      message: `Defer Advisor supports query operations only; ${selected} is a ${operation.operation}.`,
    };
  }

  const validationErrors = validate(schema, document);
  if (validationErrors.length > 0) {
    return { ok: false, message: `Invalid query: ${validationErrors[0].message}` };
  }

  const parsedVariables = parseVariables(serializedVariables);
  if (!parsedVariables.ok) {
    return parsedVariables;
  }
  const variableValues = getVariableValues(schema, operation.variableDefinitions ?? [], parsedVariables.variables);
  if (variableValues.errors?.length) {
    return { ok: false, message: variableValues.errors[0].message };
  }

  const body: Record<string, unknown> = { query };
  if (selectedOperationName) {
    body.operationName = selectedOperationName;
  }
  if (Object.keys(parsedVariables.variables).length > 0) {
    body.variables = parsedVariables.variables;
  }
  return { ok: true, body, operationName: selectedOperationName };
};

type AdvisorResponseClassification =
  | { kind: 'success'; result: unknown }
  | { kind: 'permanent-error' | 'retryable-error'; message: string };

const payloadError = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') {
    return;
  }
  const errors = (payload as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return;
  }
  const first = errors[0];
  return first && typeof first === 'object' && typeof (first as { message?: unknown }).message === 'string'
    ? (first as { message: string }).message
    : undefined;
};

export const classifyDeferAdvisorResponse = ({
  status,
  statusText,
  payload,
}: {
  status: number;
  statusText: string;
  payload: unknown;
}): AdvisorResponseClassification => {
  const error = payloadError(payload);
  if (status >= 400) {
    const message = error || `${status} ${statusText || 'Request failed'}`;
    return status < 500 || status === 501 ? { kind: 'permanent-error', message } : { kind: 'retryable-error', message };
  }

  const result =
    payload && typeof payload === 'object'
      ? (payload as { extensions?: { deferAdvisor?: unknown } }).extensions?.deferAdvisor
      : undefined;
  if (result !== undefined) {
    return { kind: 'success', result };
  }
  return {
    kind: 'permanent-error',
    message: error || 'The router did not return Defer Advisor data.',
  };
};

export class DeferAdvisorRequestGuard {
  private generation = 0;
  private controller?: AbortController;

  start() {
    this.invalidate();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    return {
      signal: controller.signal,
      isCurrent: () => this.generation === generation && !controller.signal.aborted,
      complete: () => {
        if (this.generation === generation && this.controller === controller) {
          this.controller = undefined;
        }
      },
    };
  }

  invalidate() {
    this.generation += 1;
    this.controller?.abort();
    this.controller = undefined;
  }
}
