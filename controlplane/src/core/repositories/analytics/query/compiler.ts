import {
  ANALYTICS_ATTRIBUTE_PREFIX,
  findAnalyticsDataset,
  type AnalyticsOperatorName,
  type AnalyticsValueType,
} from '@wundergraph/cosmo-shared';
import { ParamBag, type ClickHouseParamValue } from '../../../clickhouse/params.js';
import { QueryCompileError } from './errors.js';
import { INTROSPECTION_SQL, type PhysicalDataset, type PhysicalMeasure, type SourceKey } from './registry.js';

export interface CompiledFilter {
  /** A dimension name or `attr:<key>`. */
  field: string;
  operator: AnalyticsOperatorName;
  values: string[];
  /** The dimension's value type (attributes are strings). */
  type: AnalyticsValueType;
}

export interface CompileScope {
  organizationId: string;
  graphIds: string[];
  /** Window, unix seconds, inclusive. */
  start: number;
  end: number;
}

/** Postgres-resolved values for virtual dimensions; only the ones the query uses need to be filled. */
export interface VirtualValues {
  /** Feature-flag composition versions and their flag names, for grouping by featureFlag. */
  flagVersions: string[];
  flagNames: string[];
  /** Feature-flag name ("" = base) → composition versions, for filtering by featureFlag. */
  flagVersionsByName: Record<string, string[]>;
  /** Subgraph name → IDs, for filtering by subgraph. */
  subgraphIdsByName: Record<string, string[]>;
  /** The organization's subgraph IDs: narrows tables whose key leads with the subgraph. */
  organizationSubgraphIds: string[];
}

export interface CompileInput {
  dataset: PhysicalDataset;
  database: string;
  dimensions: string[];
  measures: string[];
  filters: CompiledFilter[];
  having: { measure: string; operator: AnalyticsOperatorName; value: number }[];
  timeBucketSeconds?: number;
  orderBy: { field: string; desc: boolean }[];
  limit: number;
  offset: number;
  rpmMinutes: number;
  scope: CompileScope;
  virtual: VirtualValues;
}

export interface CompiledColumn {
  name: string;
  alias: string;
  role: 'dimension' | 'measure';
  kind: 'number' | 'datetime' | 'string' | 'boolean';
}

export interface CompiledQuery {
  sql: string;
  params: Record<string, ClickHouseParamValue>;
  columns: CompiledColumn[];
  tables: string[];
}

export const TIME_BUCKET_DIMENSION = 'time';

/** The window on a table's time column, plus its stored bucket column when it has one (see span_search). */
export const windowPredicates = (timeColumn: string, bucketColumn?: string) => [
  ...(bucketColumn
    ? [
        `${bucketColumn} >= toStartOfFifteenMinutes(toDateTime({start:UInt32}))`,
        `${bucketColumn} <= toStartOfFifteenMinutes(toDateTime({end:UInt32}))`,
      ]
    : []),
  `${timeColumn} >= toDateTime({start:UInt32})`,
  `${timeColumn} <= toDateTime({end:UInt32})`,
];

const COMPARISON: Partial<Record<AnalyticsOperatorName, string>> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

const PARAM_TYPE: Record<AnalyticsValueType, string> = {
  string: 'String',
  number: 'Float64',
  boolean: 'Bool',
  datetime: 'DateTime',
};

/**
 * The single place that scopes a query to a tenant. Every table the compiler reads is followed by this predicate.
 */
export const tenantPredicate = () =>
  'OrganizationID = {organizationId:String} AND FederatedGraphID IN {graphIds:Array(String)}';

const typedValue = (type: AnalyticsValueType, value: string): ClickHouseParamValue => {
  if (type === 'number') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new QueryCompileError(`"${value}" is not a number.`);
    }
    return parsed;
  }
  if (type === 'boolean') {
    if (value !== 'true' && value !== 'false') {
      throw new QueryCompileError(`"${value}" is not a boolean; use true or false.`);
    }
    return value === 'true';
  }
  return value;
};

/** Introspection queries are left out of schema usage unless a filter on `isIntrospection` asks for them. */
export const excludesIntrospection = (dataset: PhysicalDataset, filters: CompiledFilter[]) =>
  Boolean(dataset.dimensions.isIntrospection) && !filters.some((filter) => filter.field === 'isIntrospection');

/** One array, or the concatenation of its chunks. */
const arrayOf = (refs: string[]) => (refs.length === 1 ? refs[0] : `arrayConcat(${refs.join(', ')})`);
/** `expr` is in any of the chunks. */
const inAny = (expr: string, refs: string[]) => refs.map((ref) => `${expr} IN ${ref}`);
/** `expr` is in none of the chunks. */
const inNone = (expr: string, refs: string[]) =>
  refs.length === 1 ? `${expr} NOT IN ${refs[0]}` : `(${refs.map((ref) => `${expr} NOT IN ${ref}`).join(' AND ')})`;
const anyOf = (terms: string[]) => (terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`);

const measureSql = (dataset: PhysicalDataset, name: string, bag: ParamBag): PhysicalMeasure => {
  const over = /^requestsOver:(\d+(?:\.\d+)?)$/.exec(name);
  if (over && dataset.sources.latency) {
    const bound = bag.add('over', 'Float64', Number(over[1]));
    // Exact only at a histogram bound: requests in the buckets above it. Any other value returns NULL.
    return {
      sql: `if(indexOf(anyLast(ExplicitBounds), ${bound}) = 0, NULL, arraySum(arraySlice(sumForEachMerge(BucketCounts), indexOf(anyLast(ExplicitBounds), ${bound}) + 1)))`,
      source: 'latency',
      kind: 'number',
    };
  }
  const measure = dataset.measures[name];
  if (!measure) {
    throw new QueryCompileError(`Unknown measure "${name}".`);
  }
  return measure;
};

const aliasOf = (role: 'd' | 'm', name: string) => `${role}_${name.replaceAll(/\W/g, '_')}`;

/** Parenthesize compound expressions so comparisons and aliases bind to the whole of them. */
const wrap = (sql: string) => (/^[\w.]+(?:\[[^\]]*])?$/.test(sql) ? sql : `(${sql})`);

export function compileQuery(input: CompileInput): CompiledQuery {
  const {
    dataset,
    database,
    dimensions,
    measures,
    filters,
    having,
    timeBucketSeconds,
    orderBy,
    limit,
    offset,
    rpmMinutes,
    scope,
    virtual,
  } = input;
  const bag = new ParamBag();
  bag.params.organizationId = scope.organizationId;
  bag.params.graphIds = scope.graphIds;
  bag.params.start = scope.start;
  bag.params.end = scope.end;

  const attributeExpr = attributeExpressions(dataset, bag);

  // Dimensions. Their value types come from the public catalog, where every dimension is typed.
  const catalogDimensions = new Map(
    (findAnalyticsDataset(dataset.name)?.dimensions ?? []).map((dimension) => [dimension.name, dimension.type]),
  );
  const dimensionSelects: string[] = [];
  const columns: CompiledColumn[] = [];
  for (const name of dimensions) {
    const alias = aliasOf('d', name);
    if (name === TIME_BUCKET_DIMENSION) {
      const time = (dataset.sources.main ?? dataset.sources.latency)!.timeColumn;
      if (!time || !timeBucketSeconds) {
        throw new QueryCompileError(`The ${dataset.name} dataset has no time series.`);
      }
      bag.params.bucketSeconds = timeBucketSeconds;
      dimensionSelects.push(
        `toUnixTimestamp(toStartOfInterval(${time}, INTERVAL {bucketSeconds:UInt32} SECOND)) AS ${alias}`,
      );
      columns.push({ name, alias, role: 'dimension', kind: 'datetime' });
      continue;
    }
    if (name.startsWith(ANALYTICS_ATTRIBUTE_PREFIX)) {
      dimensionSelects.push(`${attributeExpr(name.slice(ANALYTICS_ATTRIBUTE_PREFIX.length)).sql} AS ${alias}`);
      columns.push({ name, alias, role: 'dimension', kind: 'string' });
      continue;
    }
    const dimension = dataset.dimensions[name];
    if (!dimension) {
      throw new QueryCompileError(`Unknown dimension "${name}".`);
    }
    if (dimension.virtual === 'featureFlag') {
      const [versions, names] = bag.addArrays(['flagVersions', 'flagNames'], [virtual.flagVersions, virtual.flagNames]);
      dimensionSelects.push(`transform(${dimension.sql}, ${arrayOf(versions)}, ${arrayOf(names)}, '') AS ${alias}`);
    } else if (dimension.array) {
      dimensionSelects.push(`arrayJoin(${dimension.sql}) AS ${alias}`);
    } else {
      dimensionSelects.push(`${wrap(dimension.sql)} AS ${alias}`);
    }
    columns.push({ name, alias, role: 'dimension', kind: catalogDimensions.get(name) ?? 'string' });
  }
  const dimensionAliases = columns.map((column) => column.alias);

  // Filters, shared by every source of the dataset.
  const filterSql: string[] = [];
  for (const filter of filters) {
    const dimension = dataset.dimensions[filter.field];
    if (dimension?.array && !dimension.virtual && dimensions.includes(filter.field)) {
      // Grouped by the same array: test the joined element, or other elements of a matching row would show up too.
      filterSql.push(scalarFilter(aliasOf('d', filter.field), filter, bag));
      continue;
    }
    filterSql.push(...compileFilter(filter, dataset, virtual, bag, attributeExpr));
  }
  if (excludesIntrospection(dataset, filters)) {
    filterSql.push(`NOT ${INTROSPECTION_SQL}`);
  }
  if (dataset.subgraphKeyColumn && !filters.some((filter) => filter.field === 'subgraph')) {
    const [ids] = bag.addArrays(['organizationSubgraphIds'], [virtual.organizationSubgraphIds]);
    filterSql.push(anyOf(inAny(dataset.subgraphKeyColumn, ids)));
  }

  // Measures, by source table.
  const measuresBySource: Partial<Record<SourceKey, string[]>> = {};
  for (const name of measures) {
    const measure = measureSql(dataset, name, bag);
    const alias = aliasOf('m', name);
    (measuresBySource[measure.source] ??= []).push(`${measure.sql} AS ${alias}`);
    columns.push({ name, alias, role: 'measure', kind: measure.kind });
    if (measure.sql.includes('{rpmMinutes:Float64}')) {
      bag.params.rpmMinutes = rpmMinutes;
    }
  }

  const tables: string[] = [];
  const sourceQuery = (key: SourceKey, measureSelects: string[]) => {
    const source = dataset.sources[key];
    if (!source) {
      throw new QueryCompileError(`The ${dataset.name} dataset has no ${key} table.`);
    }
    tables.push(source.table);
    const where = [tenantPredicate()];
    if (source.timeColumn) {
      where.push(...windowPredicates(source.timeColumn, source.bucketColumn));
    } else {
      where.push(
        `OperationHash IN (SELECT OperationHash FROM ${database}.gql_metrics_schema_usage_lite_1d_90d WHERE ${tenantPredicate()} AND Timestamp >= toStartOfDay(toDateTime({start:UInt32})) AND Timestamp <= toDateTime({end:UInt32}))`,
      );
    }
    where.push(...(source.where ?? []), ...filterSql);
    const select = [...dimensionSelects, ...measureSelects];
    return [
      `SELECT ${select.join(', ')}`,
      `FROM ${database}.${source.table}`,
      `WHERE ${where.join(' AND ')}`,
      dimensionAliases.length > 0 ? `GROUP BY ${dimensionAliases.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  };

  const havingSql = having.map((having) => {
    const operator = COMPARISON[having.operator];
    if (!operator) {
      throw new QueryCompileError(`Operator "${having.operator}" can't compare measures.`);
    }
    return `${aliasOf('m', having.measure)} ${operator} ${bag.add('having', 'Float64', having.value)}`;
  });

  const sources = Object.keys(measuresBySource) as SourceKey[];
  let sql: string;
  if (sources.length <= 1) {
    const key = sources[0] ?? (dataset.sources.main ? 'main' : 'latency');
    sql = sourceQuery(key, measuresBySource[key] ?? []);
    if (havingSql.length > 0) {
      sql += ` HAVING ${havingSql.join(' AND ')}`;
    }
  } else {
    // Each table aggregated on the same dimensions, then joined on them (the existing repositories merge the
    // request and latency tables the same way, in memory).
    const main = sourceQuery('main', measuresBySource.main!);
    const latency = sourceQuery('latency', measuresBySource.latency!);
    const outer = [...dimensionAliases, ...columns.filter((c) => c.role === 'measure').map((c) => c.alias)];
    const join =
      dimensionAliases.length > 0
        ? `(${main}) AS m FULL OUTER JOIN (${latency}) AS l USING (${dimensionAliases.join(', ')})`
        : `(${main}) AS m CROSS JOIN (${latency}) AS l`;
    sql = `SELECT ${outer.join(', ')} FROM ${join}`;
    if (havingSql.length > 0) {
      sql += ` WHERE ${havingSql.join(' AND ')}`;
    }
  }

  // Order: the requested fields, then every dimension, so pages are stable.
  const order = orderBy.map((sort) => {
    const column = columns.find((c) => c.name === sort.field);
    if (!column) {
      throw new QueryCompileError(`Can't sort by "${sort.field}": it isn't a dimension or measure of the query.`);
    }
    return `${column.alias} ${sort.desc ? 'DESC' : 'ASC'}`;
  });
  for (const alias of dimensionAliases) {
    if (!order.some((entry) => entry.startsWith(`${alias} `))) {
      order.push(`${alias} ASC`);
    }
  }
  const fill = dimensions.length === 1 && dimensions[0] === TIME_BUCKET_DIMENSION && orderBy.length === 0;
  if (fill) {
    bag.params.fillFrom = Math.floor(scope.start / timeBucketSeconds!) * timeBucketSeconds!;
    bag.params.fillTo = scope.end + 1;
    sql += ` ORDER BY ${dimensionAliases[0]} ASC WITH FILL FROM {fillFrom:UInt32} TO {fillTo:UInt32} STEP {bucketSeconds:UInt32}`;
  } else if (order.length > 0) {
    sql += ` ORDER BY ${order.join(', ')}`;
  }
  bag.params.limit = limit;
  bag.params.offset = offset;
  sql += ' LIMIT {limit:UInt32} OFFSET {offset:UInt32}';
  if (sources.length > 1) {
    // Without this a missing side reads as 0 (e.g. a p95 of 0 for an operation with no latency rows).
    sql += ' SETTINGS join_use_nulls = 1';
  }

  return { sql, params: bag.params, columns, tables };
}

function attributeExpressions(dataset: PhysicalDataset, bag: ParamBag) {
  const refs = new Map<string, string>();
  return (key: string) => {
    if (!dataset.attributeMap) {
      throw new QueryCompileError(`The ${dataset.name} dataset has no span attributes.`);
    }
    let ref = refs.get(key);
    if (!ref) {
      ref = bag.add('attr', 'String', key);
      refs.set(key, ref);
    }
    return { sql: `${dataset.attributeMap}[${ref}]`, ref };
  };
}

const NO_VIRTUAL_VALUES: VirtualValues = {
  flagVersions: [],
  flagNames: [],
  flagVersionsByName: {},
  subgraphIdsByName: {},
  organizationSubgraphIds: [],
};

/** Row predicates for these filters on a dataset without virtual dimensions (the trace search uses it). */
export function compileFilters(dataset: PhysicalDataset, filters: CompiledFilter[], bag: ParamBag): string[] {
  const attributeExpr = attributeExpressions(dataset, bag);
  return filters.flatMap((filter) => compileFilter(filter, dataset, NO_VIRTUAL_VALUES, bag, attributeExpr));
}

function compileFilter(
  filter: CompiledFilter,
  dataset: PhysicalDataset,
  virtual: VirtualValues,
  bag: ParamBag,
  attributeExpr: (key: string) => { sql: string; ref: string },
): string[] {
  const { field, operator, values } = filter;
  const negate = operator === 'neq' || operator === 'not_in';
  const many = operator === 'in' || operator === 'not_in';
  if (!many && operator !== 'exists' && values.length !== 1) {
    throw new QueryCompileError(`Filter "${field} ${operator}" takes exactly one value.`);
  }
  if (many && values.length === 0) {
    throw new QueryCompileError(`Filter "${field} ${operator}" needs at least one value.`);
  }

  if (field.startsWith(ANALYTICS_ATTRIBUTE_PREFIX)) {
    const { sql, ref } = attributeExpr(field.slice(ANALYTICS_ATTRIBUTE_PREFIX.length));
    if (operator === 'exists') {
      return [`mapContains(${dataset.attributeMap}, ${ref})`];
    }
    return [scalarFilter(sql, filter, bag)];
  }
  if (operator === 'exists') {
    throw new QueryCompileError('The exists operator only applies to attr:<key> fields.');
  }

  const dimension = dataset.dimensions[field];
  if (!dimension) {
    throw new QueryCompileError(`Unknown dimension "${field}".`);
  }

  switch (dimension.virtual) {
    case 'graph': {
      // Applied when the graphs are resolved: the tenant predicate already holds only the matching graphs.
      return [];
    }
    case 'subgraph': {
      const ids = [...new Set(values.flatMap((name) => virtual.subgraphIdsByName[name] ?? []))];
      const refs = bag.addArray('subgraphs', ids);
      const test = dimension.array ? `hasAny(${dimension.sql}, ${arrayOf(refs)})` : anyOf(inAny(dimension.sql, refs));
      return [negate ? `NOT ${test}` : test];
    }
    case 'featureFlag': {
      const versions = [...new Set(values.flatMap((name) => virtual.flagVersionsByName[name] ?? []))];
      const terms = inAny(dimension.sql, bag.addArray('flagFilter', versions));
      if (values.includes('')) {
        // The base graph: any version that isn't a feature-flag composition.
        const [all] = bag.addArrays(['allFlagVersions'], [virtual.flagVersions]);
        terms.push(inNone(dimension.sql, all));
      }
      const test = anyOf(terms);
      return [negate ? `NOT ${test}` : test];
    }
    case 'composition': {
      const ref = bag.add('compositions', 'Array(String)', values);
      const test = `${dimension.sql} IN ${ref}`;
      return [negate ? `NOT ${test}` : test];
    }
  }

  if (dimension.array) {
    if (operator === 'contains' || operator === 'starts_with') {
      const ref = bag.add('f', 'String', values[0]);
      const test = operator === 'contains' ? `positionCaseInsensitive(x, ${ref}) > 0` : `startsWith(x, ${ref})`;
      return [`arrayExists(x -> ${test}, ${dimension.sql})`];
    }
    const ref = bag.add('f', 'Array(String)', values);
    const test = `hasAny(${dimension.sql}, ${ref})`;
    return [negate ? `NOT ${test}` : test];
  }
  return [scalarFilter(wrap(dimension.sql), filter, bag)];
}

function scalarFilter(expr: string, filter: CompiledFilter, bag: ParamBag): string {
  const { operator, values, type } = filter;
  const paramType = PARAM_TYPE[type];
  switch (operator) {
    case 'in':
    case 'not_in': {
      const ref = bag.add(
        'f',
        `Array(${paramType})`,
        type === 'number' ? values.map((v) => typedValue(type, v) as number) : values,
      );
      return `${expr} ${operator === 'in' ? 'IN' : 'NOT IN'} ${ref}`;
    }
    case 'contains': {
      return `positionCaseInsensitive(${expr}, ${bag.add('f', 'String', values[0])}) > 0`;
    }
    case 'starts_with': {
      return `startsWith(${expr}, ${bag.add('f', 'String', values[0])})`;
    }
    default: {
      const comparison = COMPARISON[operator];
      if (!comparison) {
        throw new QueryCompileError(`Unsupported operator "${operator}".`);
      }
      return `${expr} ${comparison} ${bag.add('f', paramType, typedValue(type, values[0]))}`;
    }
  }
}
