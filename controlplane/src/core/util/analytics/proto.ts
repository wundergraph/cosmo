import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  AnalyticsOperator,
  type AnalyticsPredicate,
  type AnalyticsQueryMeta,
  type AnalyticsViewRowValue,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { AnalyticsDatasetDescriptor, AnalyticsOperatorName } from '@wundergraph/cosmo-shared';
import type { FeatureIds, PlainMessage } from '../../../types/index.js';
import { PublicError } from '../../errors/errors.js';
import type { EngineGraph, EngineValue } from '../../repositories/analytics/query/engine.js';
import {
  QueryBudgetError,
  QueryCompileError,
  QueryValidationError,
} from '../../repositories/analytics/query/errors.js';
import {
  retentionStartOf,
  toIso,
  type ResolvedWindow,
  type Window,
} from '../../repositories/analytics/query/window.js';

/** Maps analytics requests and results between the proto messages and the query layer. */

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
  if (resolved.requested.start < retentionStartOf(nowSeconds, retention)) {
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
