import {
  ANALYTICS_ATTRIBUTE_KEY_PATTERN,
  ANALYTICS_ATTRIBUTE_PREFIX,
  findAnalyticsDataset,
  type AnalyticsDatasetDescriptor,
  type AnalyticsOperatorName,
} from '@wundergraph/cosmo-shared';
import { TIME_BUCKET_DIMENSION, type CompiledFilter } from './compiler.js';
import { findPhysicalDataset, HIDDEN_DIMENSIONS, REQUESTS_ROOT_SPANS, type PhysicalDataset } from './registry.js';
import { QueryValidationError, TIME_BUCKET_SECONDS } from './window.js';

export interface AnalyticsQueryRequest {
  dataset: string;
  dimensions: string[];
  measures: string[];
  filters: { field: string; operator: AnalyticsOperatorName; values: string[] }[];
  having: { measure: string; operator: AnalyticsOperatorName; value: number }[];
  timeBucket?: string;
  orderBy: { field: string; desc: boolean }[];
  limit?: number;
  includeInactive: boolean;
  compare?: { previousPeriod: boolean; baselineStart?: string; baselineEnd?: string; minVolume?: number };
}

export interface ValidatedQuery {
  descriptor: AnalyticsDatasetDescriptor;
  physical: PhysicalDataset;
  dimensions: string[];
  measures: string[];
  filters: CompiledFilter[];
  having: AnalyticsQueryRequest['having'];
  timeBucket?: string;
  timeBucketSeconds?: number;
  orderBy: AnalyticsQueryRequest['orderBy'];
  limit: number;
  includeInactive: boolean;
  compare?: AnalyticsQueryRequest['compare'];
}

export const MAX_LIMIT = 1000;
export const DEFAULT_LIMIT = 20;
const MAX_MEASURES = 20;
const MAX_DIMENSIONS = 6;
const COMPARISONS: AnalyticsOperatorName[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'];

const list = (names: string[]) => names.join(', ');

const isAttribute = (field: string) => field.startsWith(ANALYTICS_ATTRIBUTE_PREFIX);

function checkAttribute(descriptor: AnalyticsDatasetDescriptor, field: string) {
  if (!descriptor.attributeDimensions) {
    throw new QueryValidationError(
      `The ${descriptor.name} dataset has no span attributes; attr:<key> is not available.`,
    );
  }
  const key = field.slice(ANALYTICS_ATTRIBUTE_PREFIX.length);
  if (!ANALYTICS_ATTRIBUTE_KEY_PATTERN.test(key)) {
    throw new QueryValidationError(
      `"${key}" is not a valid attribute key (letters, digits, '_', '.', '-', at most 128 characters).`,
    );
  }
}

export function validateQuery(request: AnalyticsQueryRequest): ValidatedQuery {
  const descriptor = findAnalyticsDataset(request.dataset);
  const basePhysical = findPhysicalDataset(request.dataset);
  if (!descriptor || !basePhysical) {
    throw new QueryValidationError(
      `Unknown dataset "${request.dataset}". Available: operation_metrics, subgraph_metrics, planning_metrics, request_volume, requests, spans, field_usage, schema_presence, router_runtime, operation_documents.`,
    );
  }
  const dimensionsByName = new Map(descriptor.dimensions.map((d) => [d.name, d]));
  const measureNames = new Set(descriptor.measures.map((m) => m.name));

  // Time bucket: a leading "time" dimension.
  let timeBucketSeconds: number | undefined;
  if (request.timeBucket !== undefined) {
    if (!descriptor.timeBuckets.includes(request.timeBucket)) {
      throw new QueryValidationError(
        descriptor.timeBuckets.length === 0
          ? `The ${descriptor.name} dataset has no time series.`
          : `timeBucket must be one of ${list(descriptor.timeBuckets)} for ${descriptor.name}.`,
      );
    }
    timeBucketSeconds = TIME_BUCKET_SECONDS[request.timeBucket];
  }

  const dimensions: string[] = timeBucketSeconds ? [TIME_BUCKET_DIMENSION] : [];
  for (const name of request.dimensions) {
    if (name === TIME_BUCKET_DIMENSION) {
      throw new QueryValidationError('Use timeBucket to group by time.');
    }
    if (isAttribute(name)) {
      checkAttribute(descriptor, name);
    } else {
      const dimension = dimensionsByName.get(name);
      if (!dimension || !dimension.groupable) {
        const groupable = descriptor.dimensions.filter((d) => d.groupable).map((d) => d.name);
        throw new QueryValidationError(
          dimension
            ? `"${name}" can only filter, not group.`
            : `Unknown dimension "${name}" for ${descriptor.name}. Available: ${list(groupable)}.`,
        );
      }
    }
    if (!dimensions.includes(name)) {
      dimensions.push(name);
    }
  }
  if (dimensions.length > MAX_DIMENSIONS) {
    throw new QueryValidationError(`At most ${MAX_DIMENSIONS} dimensions.`);
  }

  const measures: string[] = [];
  const requestedMeasures = request.measures.length > 0 ? request.measures : descriptor.defaultMeasures;
  for (const name of requestedMeasures) {
    const parameterized = /^(\w+):(.+)$/.exec(name);
    if (parameterized) {
      const pattern = descriptor.parameterizedMeasures.find((p) => p.pattern.startsWith(`${parameterized[1]}:`));
      if (!pattern || !/^\d+(?:\.\d+)?$/.test(parameterized[2])) {
        throw new QueryValidationError(
          pattern
            ? `${parameterized[1]} takes a number of milliseconds, e.g. ${parameterized[1]}:500.`
            : `Unknown measure "${name}" for ${descriptor.name}.`,
        );
      }
    } else if (!measureNames.has(name)) {
      throw new QueryValidationError(
        `Unknown measure "${name}" for ${descriptor.name}. Available: ${list([...measureNames])}.`,
      );
    }
    if (!measures.includes(name)) {
      measures.push(name);
    }
  }

  const filters: CompiledFilter[] = request.filters.map((filter) => {
    if (isAttribute(filter.field)) {
      checkAttribute(descriptor, filter.field);
      return { ...filter, type: 'string' };
    }
    const dimension = dimensionsByName.get(filter.field);
    if (!dimension) {
      throw new QueryValidationError(
        `Unknown filter field "${filter.field}" for ${descriptor.name}. Available: ${list([...dimensionsByName.keys()])}.`,
      );
    }
    if (!dimension.operators.includes(filter.operator)) {
      throw new QueryValidationError(`${filter.field} supports ${list(dimension.operators)}, not ${filter.operator}.`);
    }
    return { ...filter, type: dimension.type };
  });

  const having = request.having.map((entry) => {
    if (!COMPARISONS.includes(entry.operator)) {
      throw new QueryValidationError(`having supports ${list(COMPARISONS)}.`);
    }
    if (!Number.isFinite(entry.value)) {
      throw new QueryValidationError('having needs a number.');
    }
    if (!measureNames.has(entry.measure) && !measures.includes(entry.measure)) {
      throw new QueryValidationError(`Unknown measure "${entry.measure}" in having.`);
    }
    const unit = descriptor.measures.find((m) => m.name === entry.measure)?.unit;
    if (unit === 'text' || unit === 'trace_id' || unit === 'datetime') {
      throw new QueryValidationError(`having compares numbers; "${entry.measure}" is not a number.`);
    }
    if (!measures.includes(entry.measure)) {
      measures.push(entry.measure);
    }
    return entry;
  });
  if (measures.length > MAX_MEASURES) {
    throw new QueryValidationError(`At most ${MAX_MEASURES} measures.`);
  }

  const compareColumns = request.compare ? measures.flatMap((m) => [`${m}Baseline`, `${m}Delta`, `${m}DeltaPct`]) : [];
  for (const sort of request.orderBy) {
    if (
      !dimensions.includes(sort.field) &&
      !measures.includes(sort.field) &&
      !compareColumns.includes(sort.field) &&
      sort.field !== TIME_BUCKET_DIMENSION
    ) {
      throw new QueryValidationError(`Can't sort by "${sort.field}": add it as a dimension or measure.`);
    }
  }

  const limit = request.limit && request.limit > 0 ? request.limit : DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) {
    throw new QueryValidationError(`limit is at most ${MAX_LIMIT}.`);
  }

  if (request.includeInactive) {
    const inventoryDimension = dimensions.filter((d) => d !== TIME_BUCKET_DIMENSION);
    if (
      inventoryDimension.length !== 1 ||
      timeBucketSeconds ||
      !descriptor.inventoryDimensions.includes(inventoryDimension[0])
    ) {
      throw new QueryValidationError(
        descriptor.inventoryDimensions.length === 0
          ? `includeInactive is not available for ${descriptor.name}.`
          : `includeInactive needs exactly one dimension out of ${list(descriptor.inventoryDimensions)}, without timeBucket.`,
      );
    }
  }
  if (request.compare && timeBucketSeconds) {
    throw new QueryValidationError('compare does not work with timeBucket; compare totals per dimension instead.');
  }
  if (
    request.compare &&
    !request.compare.previousPeriod &&
    (!request.compare.baselineStart || !request.compare.baselineEnd)
  ) {
    throw new QueryValidationError('compare needs previousPeriod or both baselineStart and baselineEnd.');
  }

  // The requests dataset reads traces_detail_by_time unless a field only root spans carry is used.
  let physical = basePhysical;
  if (descriptor.name === 'requests') {
    const fields = [...dimensions, ...filters.map((f) => f.field)].filter((f) => f !== TIME_BUCKET_DIMENSION);
    if (fields.some((field) => isAttribute(field) || !basePhysical.dimensions[field])) {
      physical = REQUESTS_ROOT_SPANS;
    }
  }

  return {
    descriptor,
    physical,
    dimensions,
    measures,
    filters,
    having,
    timeBucket: request.timeBucket,
    timeBucketSeconds,
    orderBy: request.orderBy,
    limit,
    includeInactive: request.includeInactive,
    compare: request.compare,
  };
}

/** For GetAnalyticsDimensionValues: the attribute keys of the span datasets are a hidden, groupable dimension. */
export function validateDimensionValuesTarget(dataset: string, dimension: string) {
  const descriptor = findAnalyticsDataset(dataset);
  const physical = findPhysicalDataset(dataset);
  if (!descriptor || !physical) {
    throw new QueryValidationError(`Unknown dataset "${dataset}".`);
  }
  if (HIDDEN_DIMENSIONS.has(dimension)) {
    if (!descriptor.attributeDimensions) {
      throw new QueryValidationError(`The ${dataset} dataset has no span attributes.`);
    }
    return { descriptor, physical: dataset === 'requests' ? REQUESTS_ROOT_SPANS : physical };
  }
  return { descriptor, physical };
}
