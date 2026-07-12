import { GraphQLSchema, OperationTypeNode, getOperationAST, getVariableValues, parse, validate } from 'graphql';
import { useEffect, useRef } from 'react';

import { applyDeferSuggestions, removeDeferredField } from './defer-advisor-rewrite';
import { clearInlineAnnotations, renderInlineAnnotations, showInlineNotice } from './defer-inline';
import { DeferAdvisorResult } from './defer-advisor-types';
import { substituteHeadersFromEnv, validateHeaders, type PlaygroundTarget } from './playground-fetcher';

// Studio embeds GraphiQL directly, so the inline defer advisor projects its
// measurements onto the same CodeMirror editor. Request construction is kept
// separate from polling so selected-operation, variables, header, and target
// rules can be verified without mounting GraphiQL.

type InlineDeferAdvisorRequestInput = {
  featureFlagName?: string;
  graphId: string;
  graphRequestToken: string;
  operationName?: string | null;
  query: string;
  schema: GraphQLSchema;
  serializedHeaders?: string | null;
  serializedVariables?: string | null;
  target: PlaygroundTarget;
};

type InlineDeferAdvisorRequest =
  | {
      ok: true;
      body: Record<string, unknown>;
      headers: Record<string, string>;
    }
  | { ok: false; notice: string };

const reservedAdvisorHeaders = new Set([
  'content-type',
  'x-feature-flag',
  'x-wg-defer-advisor',
  'x-wg-defer-advisor-runs',
  'x-wg-defer-advisor-skip-validation',
  'x-wg-token',
  'x-wg-trace',
]);

const parseJSONObject = (serialized: string | null | undefined): Record<string, unknown> | undefined => {
  const parsed = JSON.parse(serialized?.trim() || '{}');
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
};

export const buildInlineDeferAdvisorRequest = (input: InlineDeferAdvisorRequestInput): InlineDeferAdvisorRequest => {
  if (input.target === 'subgraph') {
    return { ok: false, notice: 'defer advisor: unavailable for subgraph requests' };
  }

  let document;
  try {
    document = parse(input.query);
  } catch {
    return { ok: false, notice: 'defer advisor: waiting for a valid operation' };
  }

  const operation = getOperationAST(document, input.operationName || undefined);
  if (!operation) {
    return input.operationName
      ? { ok: false, notice: `defer advisor: operation "${input.operationName}" was not found` }
      : { ok: false, notice: 'defer advisor: select a query operation' };
  }
  if (operation.operation !== OperationTypeNode.QUERY) {
    return { ok: false, notice: 'defer advisor: only query operations can be measured' };
  }

  const validationErrors = validate(input.schema, document);
  if (validationErrors.length > 0) {
    return { ok: false, notice: `defer advisor: invalid query — ${validationErrors[0].message}` };
  }

  let variables: Record<string, unknown>;
  try {
    const parsed = parseJSONObject(input.serializedVariables);
    if (!parsed) {
      return { ok: false, notice: 'defer advisor: variables must be a valid JSON object' };
    }
    variables = parsed;
  } catch {
    return { ok: false, notice: 'defer advisor: variables must be a valid JSON object' };
  }

  const variableValues = getVariableValues(input.schema, operation.variableDefinitions ?? [], variables);
  if (variableValues.errors?.length) {
    return { ok: false, notice: `defer advisor: invalid variables — ${variableValues.errors[0].message}` };
  }

  let userHeaders: Record<string, string>;
  try {
    const parsed = parseJSONObject(input.serializedHeaders);
    if (!parsed) {
      return { ok: false, notice: 'defer advisor: headers must be a valid JSON object' };
    }
    userHeaders = Object.fromEntries(
      Object.entries(parsed)
        .filter(([name]) => !reservedAdvisorHeaders.has(name.toLowerCase()))
        .map(([name, value]) => [name, String(value)]),
    );
    userHeaders = substituteHeadersFromEnv(userHeaders, input.graphId);
    validateHeaders(userHeaders);
  } catch {
    return { ok: false, notice: 'defer advisor: headers must be a valid JSON object' };
  }

  const headers: Record<string, string> = {
    ...userHeaders,
    'Content-Type': 'application/json',
    'X-WG-Defer-Advisor': 'enable',
    'X-WG-Defer-Advisor-Runs': '1',
    'X-WG-Defer-Advisor-Skip-Validation': 'true',
  };
  if (input.graphRequestToken) {
    headers['X-WG-Token'] = input.graphRequestToken;
  }
  if (input.target === 'featureFlag' && input.featureFlagName) {
    headers['X-Feature-Flag'] = input.featureFlagName;
  }

  const body: Record<string, unknown> = { query: input.query };
  if (input.operationName) {
    body.operationName = input.operationName;
  }
  if (Object.keys(variables).length > 0) {
    body.variables = variables;
  }

  return { ok: true, body, headers };
};

type InlineDeferAdvisorResponse =
  | { kind: 'success'; result: DeferAdvisorResult }
  | { kind: 'permanent-error'; message: string }
  | { kind: 'retryable-error'; message: string };

const responseErrorMessage = (data: unknown): string | undefined => {
  if (!data || typeof data !== 'object') {
    return;
  }
  const errors = (data as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return;
  }
  const first = errors[0];
  return first && typeof first === 'object' && 'message' in first && typeof first.message === 'string'
    ? first.message
    : undefined;
};

export const readInlineDeferAdvisorResponse = async (response: Response): Promise<InlineDeferAdvisorResponse> => {
  let data: any;
  try {
    data = await response.json();
  } catch {
    data = undefined;
  }

  if (!response.ok) {
    const routerMessage = responseErrorMessage(data);
    if (response.status >= 400 && response.status < 500) {
      return {
        kind: 'permanent-error',
        message: `defer advisor: ${routerMessage || `request rejected with ${response.status}`}`,
      };
    }
    return {
      kind: 'retryable-error',
      message: `defer advisor: router returned ${response.status}; retrying`,
    };
  }

  const result: DeferAdvisorResult | undefined = data?.extensions?.deferAdvisor;
  if (!result) {
    return {
      kind: 'permanent-error',
      message: 'defer advisor: this router does not support inline defer analysis',
    };
  }
  return { kind: 'success', result };
};

type InlineDeferAdvisorIdentityInput = {
  environmentRevision?: string;
  featureFlagName?: string;
  graphId: string;
  graphRequestToken: string;
  headers?: string | null;
  operationName?: string | null;
  query?: string | null;
  routingUrl: URL | string;
  target: PlaygroundTarget;
  variables?: string | null;
};

export const inlineDeferAdvisorIdentity = (input: InlineDeferAdvisorIdentityInput) =>
  JSON.stringify([
    input.query ?? '',
    input.operationName ?? '',
    input.variables ?? '',
    input.headers ?? '',
    input.target,
    String(input.routingUrl),
    input.graphId,
    input.graphRequestToken,
    input.featureFlagName ?? '',
    input.environmentRevision ?? '',
  ]);

type UseInlineDeferAdvisorOptions = {
  debounceMs?: number;
  enabled: boolean;
  environmentRevision?: string;
  featureFlagName?: string;
  fetchImpl?: typeof fetch;
  graphId: string;
  graphRequestToken: string;
  headers?: string | null;
  operationName?: string | null;
  pollIntervalMs?: number;
  query?: string | null;
  ready: boolean;
  schema: GraphQLSchema | null;
  target: PlaygroundTarget;
  url: URL | string;
  variables?: string | null;
};

const isAbortError = (error: unknown) =>
  !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError';

export const useInlineDeferAdvisor = (opts: UseInlineDeferAdvisorOptions) => {
  const identity = inlineDeferAdvisorIdentity({
    environmentRevision: opts.environmentRevision,
    featureFlagName: opts.featureFlagName,
    graphId: opts.graphId,
    graphRequestToken: opts.graphRequestToken,
    headers: opts.headers,
    operationName: opts.operationName,
    query: opts.query,
    routingUrl: opts.url,
    target: opts.target,
    variables: opts.variables,
  });
  const activeIdentity = useRef(identity);
  const inlineResult = useRef<{ identity: string; result: DeferAdvisorResult } | null>(null);
  if (activeIdentity.current !== identity) {
    activeIdentity.current = identity;
    inlineResult.current = null;
  }

  useEffect(() => {
    const cm = (document.querySelector('.graphiql-query-editor .CodeMirror') as any)?.CodeMirror;
    if (!cm || !opts.ready) {
      return;
    }
    if (!opts.enabled) {
      clearInlineAnnotations();
      return;
    }
    if (!opts.schema) {
      showInlineNotice(cm, 'defer advisor: waiting for the graph schema', false);
      return;
    }
    const schema = opts.schema;

    let disposed = false;
    let activeController: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const query = opts.query ?? '';
    const operationName = opts.operationName || undefined;
    const isCurrent = () => !disposed && activeIdentity.current === identity && cm.getValue() === query;

    const rerender = () => {
      const cached = inlineResult.current;
      if (cached?.identity === identity && isCurrent()) {
        renderInlineAnnotations(cm, query, cached.result, callbacks, operationName);
      }
    };
    const callbacks = {
      onDefer: (parentPath: string, field: string, label: string) => {
        try {
          cm.setValue(
            applyDeferSuggestions(cm.getValue(), [{ path: parentPath, fields: [field], label }], operationName),
          );
          clearInlineAnnotations();
        } catch {
          // The field is gone from the operation; the next cycle refreshes.
        }
      },
      onUndefer: (parentPath: string, field: string) => {
        try {
          cm.setValue(removeDeferredField(cm.getValue(), parentPath, field, operationName));
          clearInlineAnnotations();
        } catch {
          // The fragment is gone from the operation; the next cycle refreshes.
        }
      },
      onApplyAll: (groups: { path: string; fields: string[]; label: string }[]) => {
        try {
          cm.setValue(applyDeferSuggestions(cm.getValue(), groups, operationName));
          clearInlineAnnotations();
        } catch {
          // The fields moved since the analysis; the next cycle refreshes.
        }
      },
    };

    const schedule = (delay: number) => {
      if (!disposed) {
        timer = setTimeout(() => void measure(), delay);
      }
    };

    const measure = async () => {
      if (!isCurrent()) {
        return;
      }
      if (!query.trim()) {
        clearInlineAnnotations();
        return;
      }

      const request = buildInlineDeferAdvisorRequest({
        featureFlagName: opts.featureFlagName,
        graphId: opts.graphId,
        graphRequestToken: opts.graphRequestToken,
        operationName,
        query,
        schema,
        serializedHeaders: opts.headers,
        serializedVariables: opts.variables,
        target: opts.target,
      });
      if (!request.ok) {
        showInlineNotice(cm, request.notice, false);
        return;
      }

      if (inlineResult.current?.identity !== identity) {
        showInlineNotice(cm, 'measuring query latency…', true);
      }
      const controller = new AbortController();
      activeController = controller;
      try {
        const response = await (opts.fetchImpl ?? globalThis.fetch)(opts.url, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(request.body),
          signal: controller.signal,
        });
        const outcome = await readInlineDeferAdvisorResponse(response);
        if (!isCurrent() || controller.signal.aborted) {
          return;
        }
        if (outcome.kind === 'permanent-error') {
          showInlineNotice(cm, outcome.message, false);
          return;
        }
        if (outcome.kind === 'retryable-error') {
          if (inlineResult.current?.identity !== identity) {
            showInlineNotice(cm, outcome.message, false);
          }
          schedule(opts.pollIntervalMs ?? 3000);
          return;
        }

        inlineResult.current = { identity, result: outcome.result };
        renderInlineAnnotations(cm, query, outcome.result, callbacks, operationName);
        schedule(opts.pollIntervalMs ?? 3000);
      } catch (error) {
        if (!isAbortError(error) && isCurrent()) {
          if (inlineResult.current?.identity !== identity) {
            showInlineNotice(cm, 'defer advisor: network error; retrying', false);
          }
          schedule(opts.pollIntervalMs ?? 3000);
        }
      } finally {
        if (activeController === controller) {
          activeController = undefined;
        }
      }
    };

    clearInlineAnnotations();
    rerender();
    schedule(opts.debounceMs ?? 300);
    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
      activeController?.abort();
      clearInlineAnnotations();
    };
  }, [
    identity,
    opts.debounceMs,
    opts.enabled,
    opts.featureFlagName,
    opts.fetchImpl,
    opts.graphId,
    opts.graphRequestToken,
    opts.headers,
    opts.operationName,
    opts.pollIntervalMs,
    opts.query,
    opts.ready,
    opts.schema,
    opts.target,
    opts.url,
    opts.variables,
  ]);
};
