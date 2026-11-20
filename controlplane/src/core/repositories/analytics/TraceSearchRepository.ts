import { ClickHouseClient } from '../../clickhouse/index.js';
import { traced } from '../../tracing.js';
import { compileFilters, ParamBag, tenantPredicate, windowPredicates, type CompiledFilter } from './query/compiler.js';
import { findPhysicalDataset, REQUESTS_ROOT_SPANS } from './query/registry.js';
import { QueryBudgetError } from './query/engine.js';
import { toIso, type Window } from './query/window.js';

export interface SpanConditionInput {
  spanName?: string;
  spanNamePrefix: boolean;
  subgraphName?: string;
  minDurationNs?: number;
  maxDurationNs?: number;
  hasError?: boolean;
  /** Filters of the spans dataset, including `attr:<key>`. */
  attributes: CompiledFilter[];
}

export interface TraceSearchInput {
  organizationId: string;
  graphId: string;
  window: Window;
  /** Filters of the requests dataset, without operationName/operationHash. */
  requestFilters: CompiledFilter[];
  /** operationName/operationHash filters: matched on the root span, or on the spans of one operation in a batch. */
  operationFilters: CompiledFilter[];
  /** The request filters use a field only root spans carry, so the search reads span_search. */
  needsRootSpans: boolean;
  spanConditions: SpanConditionInput[];
  minDurationNs?: number;
  maxDurationNs?: number;
  hasError?: boolean;
  sort: 'timestamp' | 'duration';
  limit: number;
  cursor?: { value: string; traceId: string };
}

export interface MatchedSpanResult {
  spanId: string;
  spanName: string;
  subgraphName: string;
  durationNs: bigint;
  condition: number;
  operationName: string;
}

export interface TraceSearchResultRow {
  traceId: string;
  spanId: string;
  timestamp: string;
  durationNs: bigint;
  operationName: string;
  operationType: string;
  operationHash: string;
  operationPersistedId: string;
  clientName: string;
  clientVersion: string;
  httpStatusCode: string;
  statusMessage: string;
  hasError: boolean;
  matchedSpans: MatchedSpanResult[];
  sortValue: string;
  sortDurationNs: bigint;
}

export interface TraceSearchOutput {
  traces: TraceSearchResultRow[];
  truncated: boolean;
  /** "requests" when only request filters were used, "spans" when span_search was read. */
  source: 'requests' | 'spans';
  tables: string[];
}

/** Matched spans returned per condition and trace. */
const MATCHED_PER_CONDITION = 5;
/** Spans of matching batched operations read per trace, before keeping each operation's own span. */
const BATCHED_SPANS_PER_TRACE = 200;
/** The router's default request timeout: a root span starts at most this long before its last span ends. */
const ROOT_LOOKUP_MARGIN_SECONDS = 60;
/** Batched traces considered per search before their roots are filtered. */
const BATCH_CANDIDATES = 1000;

/**
 * A batched request runs each operation as a child of its root span; the router names that span after the operation and
 * marks it, and every span inside it, with the operation's batch index ("batch-operation-N").
 */
const BATCH_INDEX = "SpanAttributes['wg.operation.batching.operation_index']";
const BATCH_OPERATION = `${BATCH_INDEX} != ''`;
const ROOT_HAS_ERROR =
  "(StatusCode = 'STATUS_CODE_ERROR' OR startsWith(HttpStatusCode, '4') OR startsWith(HttpStatusCode, '5') OR mapContains(SpanAttributes, 'wg.request.error'))";

interface RootRow {
  traceId: string;
  spanId: string;
  ts: number;
  duration: string;
  operationName: string;
  operationType: string;
  operationHash: string;
  operationPersistedId: string;
  clientName: string;
  clientVersion: string;
  httpStatusCode: string;
  statusMessage: string;
  hasError: boolean | number;
}

const ROOT_COLUMNS = `TraceId AS traceId, SpanId AS spanId, toUnixTimestamp(Timestamp) AS ts, Duration AS duration,
  OperationName AS operationName, OperationType AS operationType, OperationHash AS operationHash,
  OperationPersistedID AS operationPersistedId, ClientName AS clientName, ClientVersion AS clientVersion,
  HttpStatusCode AS httpStatusCode, StatusMessage AS statusMessage, HasError AS hasError`;

/**
 * Searches sampled traces (spec §7.5). Request filters alone read the root rows in traces_detail_by_time; span
 * conditions and root-span attributes read span_search, grouped by trace. Operation filters also match operations inside
 * batched requests (a batch has one root span without an operation name; the spans of each operation carry its batch
 * index).
 */
@traced
export class TraceSearchRepository {
  constructor(
    private client: ClickHouseClient,
    private rowBudget: number,
  ) {}

  public search(input: TraceSearchInput): Promise<TraceSearchOutput> {
    if (input.spanConditions.length > 0 || input.needsRootSpans) {
      return this.searchSpans(input);
    }
    return this.searchRequests(input);
  }

  private baseParams(input: TraceSearchInput, bag: ParamBag) {
    bag.params.organizationId = input.organizationId;
    bag.params.graphIds = [input.graphId];
    bag.params.start = input.window.start;
    bag.params.end = input.window.end;
    bag.params.limit = input.limit + 1;
  }

  /** Root rows of traces_detail_by_time, plus batched requests whose operation matches. */
  private async searchRequests(input: TraceSearchInput): Promise<TraceSearchOutput> {
    const requests = findPhysicalDataset('requests')!;
    const sortColumn = input.sort === 'duration' ? 'Duration' : 'Timestamp';
    const cursorSql = (bag: ParamBag) => {
      if (!input.cursor) {
        return [];
      }
      const value =
        input.sort === 'duration'
          ? bag.add('cursorValue', 'Int64', input.cursor.value)
          : `toDateTime(${bag.add('cursorValue', 'UInt32', Number(input.cursor.value))})`;
      const trace = bag.add('cursorTrace', 'String', input.cursor.traceId);
      return [`(${sortColumn} < ${value} OR (${sortColumn} = ${value} AND TraceId < ${trace}))`];
    };
    const requestConditions = (bag: ParamBag) => [
      ...compileFilters(requests, input.requestFilters, bag),
      ...(input.minDurationNs === undefined
        ? []
        : [`Duration >= ${bag.add('minDuration', 'Int64', input.minDurationNs)}`]),
      ...(input.maxDurationNs === undefined
        ? []
        : [`Duration <= ${bag.add('maxDuration', 'Int64', input.maxDurationNs)}`]),
      ...(input.hasError === undefined ? [] : [`HasError = ${bag.add('hasError', 'Bool', input.hasError)}`]),
      ...cursorSql(bag),
    ];

    const direct = new ParamBag();
    this.baseParams(input, direct);
    const directSql = `SELECT ${ROOT_COLUMNS} FROM ${this.client.database}.traces_detail_by_time WHERE ${[
      tenantPredicate(),
      'Timestamp >= toDateTime({start:UInt32})',
      'Timestamp <= toDateTime({end:UInt32})',
      ...compileFilters(requests, input.operationFilters, direct),
      ...requestConditions(direct),
    ].join(' AND ')} ORDER BY ${sortColumn} DESC, TraceId DESC LIMIT {limit:UInt32}`;
    const tables = ['traces_detail_by_time'];
    await this.checkBudget(directSql, direct.params, 'requests');
    const directRows = await this.query<RootRow>(directSql, direct.params);
    let rows = directRows.map((row) => toResult(row, [], input.sort));

    if (input.operationFilters.length > 0) {
      tables.push('span_search');
      const batched = await this.batchedMatches(input);
      if (batched.size > 0) {
        const bag = new ParamBag();
        this.baseParams(input, bag);
        bag.params.batchTraceIds = [...batched.keys()];
        bag.params.margin = ROOT_LOOKUP_MARGIN_SECONDS;
        const sql = `SELECT ${ROOT_COLUMNS} FROM ${this.client.database}.traces_detail_by_time WHERE ${[
          tenantPredicate(),
          'Timestamp >= toDateTime({start:UInt32}) - {margin:UInt32}',
          'Timestamp <= toDateTime({end:UInt32}) + {margin:UInt32}',
          'TraceId IN {batchTraceIds:Array(String)}',
          ...requestConditions(bag),
        ].join(' AND ')} ORDER BY ${sortColumn} DESC, TraceId DESC LIMIT {limit:UInt32}`;
        const batchRows = await this.query<RootRow>(sql, bag.params);
        rows.push(...batchRows.map((row) => toResult(row, batched.get(row.traceId) ?? [], input.sort)));
      }
      const seen = new Set<string>();
      rows = rows.filter((row) => (seen.has(row.traceId) ? false : (seen.add(row.traceId), true))).sort(compareResults);
    }

    return { traces: rows.slice(0, input.limit), truncated: rows.length > input.limit, source: 'requests', tables };
  }

  /**
   * Operations inside batched requests whose operation matches, by trace: per batch index, the longest span carrying
   * it, which is the operation's own span (its phase and fetch spans run inside it).
   */
  private async batchedMatches(input: TraceSearchInput) {
    const spans = findPhysicalDataset('spans')!;
    const bag = new ParamBag();
    this.baseParams(input, bag);
    bag.params.candidates = BATCH_CANDIDATES;
    const sql = `SELECT TraceId AS traceId, groupArray(${MATCHED_PER_CONDITION})(tuple(opSpanId, opSpanName, opSubgraph, opDuration, opName)) AS spans FROM (SELECT TraceId, argMax(SpanId, Duration) AS opSpanId, argMax(SpanName, Duration) AS opSpanName, argMax(SubgraphName, Duration) AS opSubgraph, max(Duration) AS opDuration, any(OperationName) AS opName FROM ${
      this.client.database
    }.span_search WHERE ${[
      tenantPredicate(),
      ...windowPredicates('Timestamp', 'TimeBucket'),
      BATCH_OPERATION,
      ...compileFilters(spans, input.operationFilters, bag),
    ].join(' AND ')} GROUP BY TraceId, ${BATCH_INDEX}) GROUP BY TraceId LIMIT {candidates:UInt32}`;
    await this.checkBudget(sql, bag.params);
    const rows = await this.query<{ traceId: string; spans: [string, string, string, string, string][] }>(
      sql,
      bag.params,
    );
    return new Map(rows.map((row) => [row.traceId, row.spans.map((span) => toMatched(span, -1))]));
  }

  /** span_search grouped by trace: every span condition must match at least one span of the trace. */
  private async searchSpans(input: TraceSearchInput): Promise<TraceSearchOutput> {
    const spans = findPhysicalDataset('spans')!;
    const bag = new ParamBag();
    this.baseParams(input, bag);

    const conditions = input.spanConditions.map((condition) => {
      const parts: string[] = [];
      if (condition.spanName !== undefined) {
        const name = bag.add('spanName', 'String', condition.spanName);
        parts.push(condition.spanNamePrefix ? `startsWith(SpanName, ${name})` : `SpanName = ${name}`);
      }
      if (condition.subgraphName !== undefined) {
        parts.push(`SubgraphName = ${bag.add('subgraph', 'String', condition.subgraphName)}`);
      }
      if (condition.minDurationNs !== undefined) {
        parts.push(`Duration >= ${bag.add('spanMin', 'Int64', condition.minDurationNs)}`);
      }
      if (condition.maxDurationNs !== undefined) {
        parts.push(`Duration <= ${bag.add('spanMax', 'Int64', condition.maxDurationNs)}`);
      }
      if (condition.hasError !== undefined) {
        parts.push(`(StatusCode = 'STATUS_CODE_ERROR') = ${bag.add('spanError', 'Bool', condition.hasError)}`);
      }
      parts.push(...compileFilters(spans, condition.attributes, bag));
      return parts.length > 0 ? parts.join(' AND ') : 'true';
    });

    const rootParts = [
      ...compileFilters(REQUESTS_ROOT_SPANS, input.requestFilters, bag),
      ...(input.minDurationNs === undefined
        ? []
        : [`Duration >= ${bag.add('minDuration', 'Int64', input.minDurationNs)}`]),
      ...(input.maxDurationNs === undefined
        ? []
        : [`Duration <= ${bag.add('maxDuration', 'Int64', input.maxDurationNs)}`]),
      ...(input.hasError === undefined ? [] : [`${ROOT_HAS_ERROR} = ${bag.add('hasError', 'Bool', input.hasError)}`]),
    ];
    const hasRoot = rootParts.length > 0;
    const hasOperation = input.operationFilters.length > 0;

    const aliases: string[] = [];
    for (const [index, sql] of conditions.entries()) {
      aliases.push(`(${sql}) AS c${index}`);
    }
    if (hasRoot) {
      aliases.push(`(IsRoot AND ${rootParts.join(' AND ')}) AS r`);
    }
    if (hasOperation) {
      aliases.push(
        `((IsRoot OR ${BATCH_OPERATION}) AND ${compileFilters(spans, input.operationFilters, bag).join(' AND ')}) AS o`,
      );
    }
    const terms = [...conditions.map((_, i) => `c${i}`), ...(hasRoot ? ['r'] : []), ...(hasOperation ? ['o'] : [])];

    let sortExpr: string;
    if (input.sort === 'duration') {
      const durations =
        conditions.length > 0
          ? conditions.map((_, i) => `maxIf(Duration, c${i})`)
          : [hasRoot ? 'maxIf(Duration, r)' : 'maxIf(Duration, o)'];
      sortExpr = durations.length === 1 ? durations[0] : `greatest(${durations.join(', ')})`;
    } else {
      sortExpr = 'toUnixTimestamp64Nano(min(Timestamp))';
    }

    const having = terms.map((term) => `countIf(${term}) > 0`);
    if (input.cursor) {
      const value = bag.add('cursorValue', 'Int64', input.cursor.value);
      const trace = bag.add('cursorTrace', 'String', input.cursor.traceId);
      having.push(`(sortNumber < ${value} OR (sortNumber = ${value} AND TraceId < ${trace}))`);
    }
    const matched = [
      ...conditions.map(
        (_, i) =>
          `groupArrayIf(${MATCHED_PER_CONDITION})(tuple(SpanId, SpanName, SubgraphName, Duration, OperationName), c${i}) AS m${i}`,
      ),
      ...(hasOperation
        ? [
            `groupArrayIf(${BATCHED_SPANS_PER_TRACE})(tuple(SpanId, SpanName, SubgraphName, Duration, OperationName, ${BATCH_INDEX}), o AND ${BATCH_OPERATION}) AS mo`,
          ]
        : []),
    ];

    const sql = `WITH ${aliases.join(', ')} SELECT TraceId AS traceId, ${sortExpr} AS sortNumber${
      matched.length > 0 ? `, ${matched.join(', ')}` : ''
    } FROM ${this.client.database}.span_search WHERE ${[tenantPredicate(), ...windowPredicates('Timestamp', 'TimeBucket')].join(' AND ')} AND (${terms.join(
      ' OR ',
    )}) GROUP BY TraceId HAVING ${having.join(' AND ')} ORDER BY sortNumber DESC, TraceId DESC LIMIT {limit:UInt32}`;
    await this.checkBudget(sql, bag.params);

    // Int64 values arrive as JSON strings.
    type SpanRow = { traceId: string; sortNumber: string } & Record<string, [string, string, string, string, string][]>;
    const rows = await this.query<SpanRow>(sql, bag.params);
    const page = rows.slice(0, input.limit);
    const roots = await this.roots(
      input,
      page.map((row) => row.traceId),
    );

    const traces = page.map((row) => {
      const matchedSpans: MatchedSpanResult[] = [
        ...conditions.flatMap((_, i) => (row[`m${i}`] ?? []).map((span) => toMatched(span, i))),
        ...batchOperationSpans((row.mo ?? []) as unknown as BatchSpan[]),
      ];
      const root = roots.get(row.traceId);
      const result = root
        ? toResult(root, matchedSpans, input.sort)
        : {
            ...emptyResult(row.traceId),
            timestamp:
              input.sort === 'timestamp' ? toIso(Math.floor(Number(BigInt(row.sortNumber) / 1_000_000_000n))) : '',
            matchedSpans,
          };
      const sortDurationNs = input.sort === 'duration' ? BigInt(row.sortNumber) : result.durationNs;
      return { ...result, sortValue: String(row.sortNumber), sortDurationNs };
    });
    return {
      traces,
      truncated: rows.length > input.limit,
      source: 'spans',
      tables: ['span_search', 'traces_detail_by_time'],
    };
  }

  /** The root rows of these traces, for the summaries; the window is widened by the router timeout. */
  private async roots(input: TraceSearchInput, traceIds: string[]) {
    if (traceIds.length === 0) {
      return new Map<string, RootRow>();
    }
    const bag = new ParamBag();
    this.baseParams(input, bag);
    bag.params.traceIds = traceIds;
    bag.params.margin = ROOT_LOOKUP_MARGIN_SECONDS;
    const sql = `SELECT ${ROOT_COLUMNS} FROM ${this.client.database}.traces_detail_by_time WHERE ${tenantPredicate()} AND Timestamp >= toDateTime({start:UInt32}) - {margin:UInt32} AND Timestamp <= toDateTime({end:UInt32}) + {margin:UInt32} AND TraceId IN {traceIds:Array(String)}`;
    const rows = await this.query<RootRow>(sql, bag.params);
    return new Map(rows.map((row) => [row.traceId, row]));
  }

  private async checkBudget(sql: string, params: ParamBag['params'], read: 'spans' | 'requests' = 'spans') {
    const rows = await this.client.estimateRows(sql, params);
    if (rows > this.rowBudget) {
      const estimate = `This search would read about ${rows.toLocaleString('en-US')}`;
      const limit = `(limit ${this.rowBudget.toLocaleString('en-US')}). Narrow the window (e.g. 6h)`;
      throw new QueryBudgetError(
        read === 'spans'
          ? `${estimate} spans ${limit} or add a span name, subgraph or operation.`
          : `${estimate} sampled requests ${limit} or add a filter such as operationName or clientName.`,
      );
    }
  }

  private async query<T>(sql: string, params: ParamBag['params']): Promise<T[]> {
    const result = await this.client.queryPromise<T>(sql, params);
    return Array.isArray(result) ? (result as T[]) : [];
  }
}

type BatchSpan = [string, string, string, string, string, string];

/** Per batch index, the longest span: the batched operation's own span. */
function batchOperationSpans(spans: BatchSpan[]): MatchedSpanResult[] {
  const longest = new Map<string, BatchSpan>();
  for (const span of spans) {
    const current = longest.get(span[5]);
    if (!current || BigInt(span[3]) > BigInt(current[3])) {
      longest.set(span[5], span);
    }
  }
  return [...longest.values()].map((span) => toMatched([span[0], span[1], span[2], span[3], span[4]], -1));
}

function toMatched(span: [string, string, string, string, string], condition: number): MatchedSpanResult {
  const [spanId, spanName, subgraphName, duration, operationName] = span;
  return { spanId, spanName, subgraphName, durationNs: BigInt(duration), condition, operationName };
}

function emptyResult(traceId: string): Omit<TraceSearchResultRow, 'sortValue' | 'sortDurationNs'> {
  return {
    traceId,
    spanId: '',
    timestamp: '',
    durationNs: 0n,
    operationName: '',
    operationType: '',
    operationHash: '',
    operationPersistedId: '',
    clientName: '',
    clientVersion: '',
    httpStatusCode: '',
    statusMessage: '',
    hasError: false,
    matchedSpans: [],
  };
}

function toResult(
  row: RootRow,
  matchedSpans: MatchedSpanResult[],
  sort: TraceSearchInput['sort'],
): TraceSearchResultRow {
  const durationNs = BigInt(row.duration);
  return {
    traceId: row.traceId,
    spanId: row.spanId,
    timestamp: toIso(Number(row.ts)),
    durationNs,
    operationName: row.operationName,
    operationType: row.operationType,
    operationHash: row.operationHash,
    operationPersistedId: row.operationPersistedId,
    clientName: row.clientName,
    clientVersion: row.clientVersion,
    httpStatusCode: row.httpStatusCode,
    statusMessage: row.statusMessage,
    hasError: row.hasError === true || row.hasError === 1,
    matchedSpans,
    sortValue: sort === 'duration' ? durationNs.toString() : String(row.ts),
    sortDurationNs: durationNs,
  };
}

function compareResults(a: TraceSearchResultRow, b: TraceSearchResultRow) {
  const left = BigInt(a.sortValue);
  const right = BigInt(b.sortValue);
  if (left !== right) {
    return left > right ? -1 : 1;
  }
  return a.traceId > b.traceId ? -1 : 1;
}
