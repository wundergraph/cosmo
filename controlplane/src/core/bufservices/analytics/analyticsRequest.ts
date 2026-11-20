import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  AnalyticsOperator,
  type AnalyticsGraphRef,
  type AnalyticsPredicate,
  type AnalyticsQueryMeta,
  type AnalyticsTimeWindow,
  type AnalyticsViewRowValue,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { AnalyticsDatasetDescriptor, AnalyticsOperatorName } from '@wundergraph/cosmo-shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AuthContext, FeatureIds, PlainMessage } from '../../../types/index.js';
import { PublicError } from '../../errors/errors.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { QueryCompileError } from '../../repositories/analytics/query/compiler.js';
import { QueryBudgetError, type EngineGraph, type EngineValue } from '../../repositories/analytics/query/engine.js';
import {
  GRAIN_SECONDS,
  QueryValidationError,
  resolveWindow,
  toIso,
  type ResolvedWindow,
  type Window,
} from '../../repositories/analytics/query/window.js';
import type { RouterOptions } from '../../routes.js';

export const GRAPH_NOT_FOUND = 'Graph not found or you have no access.';

const OPERATOR_NAMES: Record<number, AnalyticsOperatorName> = {
  [AnalyticsOperator.EQ]: 'eq',
  [AnalyticsOperator.NEQ]: 'neq',
  [AnalyticsOperator.IN]: 'in',
  [AnalyticsOperator.NOT_IN]: 'not_in',
  [AnalyticsOperator.GT]: 'gt',
  [AnalyticsOperator.GTE]: 'gte',
  [AnalyticsOperator.LT]: 'lt',
  [AnalyticsOperator.LTE]: 'lte',
  [AnalyticsOperator.CONTAINS]: 'contains',
  [AnalyticsOperator.STARTS_WITH]: 'starts_with',
  [AnalyticsOperator.EXISTS]: 'exists',
};

export function operatorName(operator: AnalyticsOperator): AnalyticsOperatorName {
  const name = OPERATOR_NAMES[operator];
  if (!name) {
    throw new PublicError(EnumStatusCode.ERR_BAD_REQUEST, 'Every filter needs an operator.');
  }
  return name;
}

export const toPredicates = (predicates: AnalyticsPredicate[]) =>
  predicates.map((predicate) => ({
    field: predicate.field,
    operator: operatorName(predicate.operator),
    values: predicate.values,
  }));

/**
 * Resolves the graphs of an analytics request inside the organization. An unknown graph and a graph the caller may not
 * read get the same answer, so the response never reveals that a graph exists.
 */
export async function resolveAnalyticsGraphs(input: {
  opts: RouterOptions;
  logger: FastifyBaseLogger;
  authContext: AuthContext;
  graphs: AnalyticsGraphRef[];
  allReadableGraphs: boolean;
}): Promise<EngineGraph[]> {
  const { opts, logger, authContext, graphs: refs, allReadableGraphs } = input;
  const repo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
  if (allReadableGraphs) {
    // Every graph of the organization, each checked on its own: the list query's RBAC filter drops graphs when namespace
    // and graph rules are combined (spec §5.5).
    const graphs = await repo.list({ limit: 0, offset: 0 });
    const readable = graphs.filter((graph) => authContext.rbac.hasFederatedGraphReadAccess(graph));
    if (readable.length === 0) {
      throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, 'You have no access to any graph.');
    }
    return readable.map((graph) => ({ id: graph.id, name: graph.name, namespace: graph.namespace }));
  }
  if (refs.length === 0) {
    throw new PublicError(EnumStatusCode.ERR_BAD_REQUEST, 'Name at least one graph, or ask for all readable graphs.');
  }
  const resolved: EngineGraph[] = [];
  for (const ref of refs) {
    const graph = await repo.byName(ref.name, ref.namespace || 'default');
    if (!graph || !authContext.rbac.hasFederatedGraphReadAccess(graph)) {
      throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, GRAPH_NOT_FOUND);
    }
    if (!resolved.some((g) => g.id === graph.id)) {
      resolved.push({ id: graph.id, name: graph.name, namespace: graph.namespace });
    }
  }
  return resolved;
}

export async function retentionDays(input: {
  opts: RouterOptions;
  logger: FastifyBaseLogger;
  organizationId: string;
  feature: FeatureIds;
  storageTtlDays: number;
}) {
  const orgRepo = new OrganizationRepository(input.logger, input.opts.db, input.opts.billingDefaultPlanId);
  const feature = await orgRepo.getFeature({ organizationId: input.organizationId, featureId: input.feature });
  return Math.min(feature?.limit ?? 7, input.storageTtlDays);
}

const OUT_OF_RETENTION = "The requested window is outside your plan's retention.";

export function resolveAnalyticsWindow(input: {
  window: AnalyticsTimeWindow | undefined;
  descriptor: AnalyticsDatasetDescriptor;
  retentionDays: number;
  nowSeconds: number;
  defaultRangeHours?: number;
}): ResolvedWindow {
  try {
    const resolved = resolveWindow({
      window: {
        rangeHours: input.window?.rangeHours,
        start: input.window?.start,
        end: input.window?.end,
      },
      retentionDays: input.retentionDays,
      nowSeconds: input.nowSeconds,
      grainSeconds: GRAIN_SECONDS[input.descriptor.grain] ?? 1,
      defaultRangeHours: input.defaultRangeHours ?? 24,
    });
    if (!resolved) {
      throw new PublicError(EnumStatusCode.ERR_BAD_REQUEST, OUT_OF_RETENTION);
    }
    return resolved;
  } catch (error) {
    throw toPublicError(error);
  }
}

/** Validation, compile and budget errors are the caller's to fix: they become ERR_BAD_REQUEST with the message. */
export function toPublicError(error: unknown): unknown {
  if (
    error instanceof QueryValidationError ||
    error instanceof QueryCompileError ||
    error instanceof QueryBudgetError
  ) {
    return new PublicError(EnumStatusCode.ERR_BAD_REQUEST, error.message);
  }
  return error;
}

export function windowWarnings(resolved: ResolvedWindow, retention: number, feature: FeatureIds, nowSeconds: number) {
  const warnings: string[] = [];
  if (resolved.requested.start < nowSeconds - retention * 86_400) {
    warnings.push(`Window clamped to ${retention} days by your plan's ${feature.replace('-', ' ')}.`);
  }
  if (resolved.requested.end > nowSeconds) {
    warnings.push('The window ended in the future; it was clamped to now.');
  }
  return warnings;
}

export const dateRange = (window: Window) => ({ start: toIso(window.start), end: toIso(window.end) });

export function toRowValue(value: EngineValue): PlainMessage<AnalyticsViewRowValue> {
  if (typeof value === 'number') {
    return { kind: { case: 'numberValue', value } };
  }
  if (typeof value === 'boolean') {
    return { kind: { case: 'boolValue', value } };
  }
  if (typeof value === 'string') {
    return { kind: { case: 'stringValue', value } };
  }
  return { kind: { case: undefined } };
}

export function baseMeta(input: {
  descriptor: AnalyticsDatasetDescriptor;
  resolved: ResolvedWindow;
  graphs: EngineGraph[];
  nowSeconds: number;
  granularity?: string;
}): PlainMessage<AnalyticsQueryMeta> {
  return {
    dataset: input.descriptor.name,
    completeness: input.descriptor.completeness,
    requestedWindow: dateRange(input.resolved.requested),
    effectiveWindow: dateRange(input.resolved.effective),
    granularity: input.granularity ?? input.descriptor.grain,
    now: toIso(input.nowSeconds),
    approximate: false,
    truncated: false,
    warnings: [],
    graphs: input.graphs.map((g) => ({ name: g.name, namespace: g.namespace })),
    tables: [],
    appliedFilters: [],
  };
}
