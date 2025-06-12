import {
  AnalyticsFilter,
  AnalyticsViewFilterOperator,
  CustomOptions,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { ClickHouseClient } from '../../clickhouse/index.js';
import { DateRange, Label } from '../../../types/index.js';
import { FederatedGraphRepository } from '../FederatedGraphRepository.js';
import * as schema from '../../../db/schema.js';
import { flipDateRangeValuesIfNeeded } from '../../util.js';
import {
  BaseFilters,
  buildAnalyticsViewFilters,
  buildCoercedFilterSqlStatement,
  CoercedFilterValues,
  coerceFilterValues,
  escapeStringsFromParams,
  getDateRange,
  getGranularity,
  isoDateRangeToTimestamps,
  parseValue,
  toISO9075,
} from './util.js';

interface GetSubgraphMetricsViewProps {
  range?: number;
  dateRange?: DateRange;
  filters: AnalyticsFilter[];
  organizationId: string;
  subgraphId: string;
  subgraphLabels: Label[];
  namespaceId: string;
}

interface GetSubgraphMetricsProps {
  granule: string;
  rangeInHours: number;
  dateRange: {
    start: number;
    end: number;
  };
  prevDateRange: {
    start: number;
    end: number;
  };
  whereSql?: string;
  organizationId: string;
  subgraphId: string;
  subgraphLabels: Label[];
  namespaceId: string;
  queryParams?: CoercedFilterValues;
}

interface LatencySeries {
  timestamp: string;
  value: string;
  p50?: number;
  p90?: number;
  p99?: number;
}

export class SubgraphMetricsRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private client: ClickHouseClient,
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Get subgraph request rate metrics
   */
  public async getSubgraphRequestRateMetrics({
    rangeInHours,
    granule,
    dateRange,
    prevDateRange,
    organizationId,
    subgraphId,
    whereSql,
    queryParams,
  }: GetSubgraphMetricsProps) {
    // to minutes
    const multiplier = rangeInHours * 60;
    flipDateRangeValuesIfNeeded(dateRange);

    // get request rate in last [range]h
    const queryRate = (start: number, end: number) => {
      return this.client.queryPromise<{ value: number | null }>(
        `
        SELECT round(sum(total) / ${multiplier}, 4) AS value FROM (
        SELECT
          toDateTime('${start}') AS startDate,
          toDateTime('${end}') AS endDate,
          sum(TotalRequests) AS total
        FROM ${this.client.database}.subgraph_request_metrics_5_30
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${organizationId}'
          AND SubgraphID = '${subgraphId}'
          ${whereSql ? `AND ${whereSql}` : ''}
        GROUP BY Timestamp 
      )
    `,
        queryParams,
      );
    };

    const requestRate = queryRate(dateRange.start, dateRange.end);
    const prevRequestRate = queryRate(prevDateRange.start, prevDateRange.end);

    // get top 5 operations in last [range] hours
    const top5 = this.client.queryPromise<{ hash: string; name: string; value: string; isPersisted: boolean }>(
      `
      WITH
        toDateTime('${dateRange.start}') AS startDate,
        toDateTime('${dateRange.end}') AS endDate
      SELECT hash, name, isPersisted, round(sum(total) / ${multiplier}, 4) AS value FROM (
        SELECT
          Timestamp as timestamp,
          OperationHash as hash,
          OperationName as name,
          IF(empty(OperationPersistedID), false, true) as isPersisted,
          sum(TotalRequests) as total
        FROM ${this.client.database}.subgraph_request_metrics_5_30
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${organizationId}'
          AND SubgraphID = '${subgraphId}'
          ${whereSql ? `AND ${whereSql}` : ''}
        GROUP BY Timestamp, OperationName, OperationHash, OperationPersistedID
      ) GROUP BY name, hash, isPersisted ORDER BY value DESC LIMIT 5
    `,
      queryParams,
    );

    // get time series of last [range] hours
    const querySeries = (start: number, end: number) => {
      return this.client.queryPromise<LatencySeries>(
        `
      WITH
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          round(sum(TotalRequests) / ${granule}, 4) AS value
      FROM ${this.client.database}.subgraph_request_metrics_5_30
      WHERE timestamp >= startDate AND timestamp <= endDate
        AND OrganizationID = '${organizationId}'
        AND SubgraphID = '${subgraphId}'
        ${whereSql ? `AND ${whereSql}` : ''}
      GROUP BY timestamp
      ORDER BY timestamp ASC WITH FILL FROM 
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE)
      TO
        toDateTime('${end}')
      STEP INTERVAL ${granule} minute
    `,
        queryParams,
      );
    };

    const series = querySeries(dateRange.start, dateRange.end);
    const prevSeries = querySeries(prevDateRange.start, prevDateRange.end);

    const [medianResponse, prevMedianResponse, top5Response, seriesResponse, prevSeriesResponse] = await Promise.all([
      requestRate,
      prevRequestRate,
      top5,
      series,
      prevSeries,
    ]);

    return {
      data: {
        value: parseValue(medianResponse[0]?.value),
        previousValue: parseValue(prevMedianResponse[0]?.value),
        top: top5Response.map((v) => ({
          hash: v.hash,
          name: v.name,
          value: parseValue(v.value),
          isPersisted: v.isPersisted,
        })),
        series: this.mapSeries(rangeInHours, seriesResponse, prevSeriesResponse),
      },
    };
  }

  /**
   * Get subgraph latency metrics
   */
  public async getSubgraphLatencyMetrics({
    rangeInHours,
    granule,
    dateRange,
    prevDateRange,
    organizationId,
    subgraphId,
    whereSql,
    queryParams,
  }: GetSubgraphMetricsProps) {
    flipDateRangeValuesIfNeeded(dateRange);

    const queryLatency = (quantile: string, start: number, end: number) => {
      return this.client.queryPromise<{ value: number }>(
        `
        WITH
          toDateTime('${start}') AS startDate,
          toDateTime('${end}') AS endDate
        SELECT
          func_rank(${quantile}, BucketCounts) as rank,
          func_rank_bucket_lower_index(rank, BucketCounts) as b,
          func_histogram_v2(
              rank,
              b,
              BucketCounts,
              anyLast(ExplicitBounds)
          ) as value,

          -- Histogram aggregations
          sumForEachMerge(BucketCounts) as BucketCounts
        FROM ${this.client.database}.subgraph_latency_metrics_5_30
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${organizationId}'
          AND SubgraphID = '${subgraphId}'
          ${whereSql ? `AND ${whereSql}` : ''}
    `,
        queryParams,
      );
    };

    const p95 = queryLatency('0.95', dateRange.start, dateRange.end);
    const prevP95 = queryLatency('0.95', prevDateRange.start, prevDateRange.end);

    // get top 5 operations in last [range] hours
    const queryTop5 = (quantile: string, start: number, end: number) => {
      return this.client.queryPromise<{ hash: string; name: string; value: string; isPersisted: boolean }>(
        `
        WITH
          toDateTime('${start}') AS startDate,
          toDateTime('${end}') AS endDate
        SELECT
          OperationHash as hash,
          OperationName as name,
          IF(empty(OperationPersistedID), false, true) as isPersisted,
          func_rank(${quantile}, BucketCounts) as rank,
          func_rank_bucket_lower_index(rank, BucketCounts) as b,
          round(func_histogram_v2(
              rank,
              b,
              BucketCounts,
              anyLast(ExplicitBounds)
          ), 2) as value,

          -- Histogram aggregations
          sumForEachMerge(BucketCounts) as BucketCounts
        FROM ${this.client.database}.subgraph_latency_metrics_5_30
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${organizationId}'
          AND SubgraphID = '${subgraphId}'
          ${whereSql ? `AND ${whereSql}` : ''}
        GROUP BY OperationName, OperationHash, OperationPersistedID ORDER BY value DESC LIMIT 5
    `,
        queryParams,
      );
    };

    const top5 = queryTop5('0.95', dateRange.start, dateRange.end);

    // get time series of last [range] hours
    const querySeries = (quantile: string, start: number, end: number) => {
      return this.client.queryPromise<LatencySeries>(
        `
        WITH
          toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE) AS startDate,
          toDateTime('${end}') AS endDate
        SELECT
            toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
            -- Default
            func_rank(${quantile}, BucketCounts) as rank,
            func_rank_bucket_lower_index(rank, BucketCounts) as b,
            func_histogram_v2(
                rank,
                b,
                BucketCounts,
                anyLast(ExplicitBounds)
            ) as value,
            -- P50
            func_rank(0.50, BucketCounts) as rank50,
            func_rank_bucket_lower_index(rank50, BucketCounts) as b50,
            func_histogram_v2(
                rank50,
                b50,
                BucketCounts,
                anyLast(ExplicitBounds)
            ) as p50,
            -- P90
            func_rank(0.90, BucketCounts) as rank90,
            func_rank_bucket_lower_index(rank90, BucketCounts) as b90,
            func_histogram_v2(
                rank90,
                b90,
                BucketCounts,
                anyLast(ExplicitBounds)
            ) as p90,
            -- P99
            func_rank(0.99, BucketCounts) as rank99,
            func_rank_bucket_lower_index(rank99, BucketCounts) as b99,
            func_histogram_v2(
                rank99,
                b99,
                BucketCounts,
                anyLast(ExplicitBounds)
            ) as p99,

            -- Histogram aggregations
            sumForEachMerge(BucketCounts) as BucketCounts
        FROM ${this.client.database}.subgraph_latency_metrics_5_30
        WHERE timestamp >= startDate AND timestamp <= endDate
          AND OrganizationID = '${organizationId}'
          AND SubgraphID = '${subgraphId}'
          ${whereSql ? `AND ${whereSql}` : ''}
        GROUP BY timestamp, ExplicitBounds
        ORDER BY timestamp ASC WITH FILL FROM
          toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE)
        TO
          toDateTime('${end}')
        STEP INTERVAL ${granule} minute
      `,
        queryParams,
      );
    };

    const series = querySeries('0.95', dateRange.start, dateRange.end);
    const prevSeries = querySeries('0.95', prevDateRange.start, prevDateRange.end);

    const [p95Response, prevP95Response, top5Response, seriesResponse, prevSeriesResponse] = await Promise.all([
      p95,
      prevP95,
      top5,
      series,
      prevSeries,
    ]);

    return {
      data: {
        value: parseValue(p95Response[0]?.value),
        previousValue: parseValue(prevP95Response[0]?.value),
        top: top5Response.map((v) => ({
          hash: v.hash,
          name: v.name,
          value: parseValue(v.value),
          isPersisted: v.isPersisted,
        })),
        series: this.mapSeries(rangeInHours, seriesResponse, prevSeriesResponse),
      },
    };
  }

  /**
   * Get error metrics
   */
  public async getSubgraphErrorMetrics({
    rangeInHours,
    granule,
    dateRange,
    prevDateRange,
    organizationId,
    subgraphId,
    whereSql,
    queryParams,
  }: GetSubgraphMetricsProps) {
    flipDateRangeValuesIfNeeded(dateRange);

    // get request rate in last [range]h
    const queryPercentage = (start: number, end: number) => {
      return this.client.queryPromise<{ errorPercentage: number }>(
        `
      WITH
        toDateTime('${start}') AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
        sum(totalErrors) AS errors,
        sum(totalRequests) AS requests,
        if(errors > 0, round(errors / requests * 100, 2), 0) AS errorPercentage
        FROM (
          SELECT
            sum(TotalRequests) as totalRequests,
            sum(TotalErrors) as totalErrors
          FROM ${this.client.database}.subgraph_request_metrics_5_30
          WHERE Timestamp >= startDate AND Timestamp <= endDate
            AND OrganizationID = '${organizationId}'
            AND SubgraphID = '${subgraphId}'
            ${whereSql ? `AND ${whereSql}` : ''}
          GROUP BY Timestamp, OperationName 
        )
    `,
        queryParams,
      );
    };

    const value = queryPercentage(dateRange.start, dateRange.end);
    const prevValue = queryPercentage(prevDateRange.start, prevDateRange.end);

    // get top 5 operations in last [range] hours
    const top5 = this.client.queryPromise<{ hash: string; name: string; value: string; isPersisted: boolean }>(
      `
      WITH
        toDateTime('${dateRange.start}') AS startDate,
        toDateTime('${dateRange.end}') AS endDate
      SELECT
        hash,
        name,
        isPersisted,
        median(errorPercentage) as value
      FROM (
        SELECT
          Timestamp as timestamp,
          OperationHash as hash,
          OperationName as name,
          sum(TotalRequests) as totalRequests,
          sum(TotalErrors) as totalErrors,
          if(totalErrors > 0, round(totalErrors / totalRequests * 100, 2), 0) AS errorPercentage,
          IF(empty(OperationPersistedID), false, true) as isPersisted
        FROM ${this.client.database}.subgraph_request_metrics_5_30
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${organizationId}'
          AND SubgraphID = '${subgraphId}'
          ${whereSql ? `AND ${whereSql}` : ''}
        GROUP BY Timestamp, OperationName, OperationHash, OperationPersistedID
      ) GROUP BY name, hash, isPersisted ORDER BY value DESC LIMIT 5
    `,
      queryParams,
    );

    // get time series of last [range] hours
    const getSeries = (start: number, end: number) => {
      return this.client.queryPromise<LatencySeries>(
        `
      WITH
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          sum(TotalErrors) AS errors,
          sum(TotalRequests) AS requests,
          if(errors > 0, round(errors / requests * 100, 2), 0) AS value
      FROM ${this.client.database}.subgraph_request_metrics_5_30
      WHERE timestamp >= startDate AND timestamp <= endDate
        AND OrganizationID = '${organizationId}'
        AND SubgraphID = '${subgraphId}'
        ${whereSql ? `AND ${whereSql}` : ''}
      GROUP BY timestamp
      ORDER BY timestamp ASC WITH FILL FROM 
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE)
      TO
        toDateTime('${end}')
      STEP INTERVAL ${granule} minute
    `,
        queryParams,
      );
    };

    const series = getSeries(dateRange.start, dateRange.end);
    const prevSeries = getSeries(prevDateRange.start, prevDateRange.end);

    const [valueResponse, prevValueResponse, top5Response, seriesResponse, prevSeriesResponse] = await Promise.all([
      value,
      prevValue,
      top5,
      series,
      prevSeries,
    ]);

    return {
      data: {
        value: parseValue(valueResponse[0].errorPercentage),
        previousValue: parseValue(prevValueResponse[0].errorPercentage),
        top: top5Response.map((v) => ({
          hash: v.hash,
          name: v.name,
          value: parseValue(v.value),
          isPersisted: v.isPersisted,
        })),
        series: this.mapSeries(rangeInHours, seriesResponse, prevSeriesResponse),
      },
    };
  }

  /**
   * Get error rate metrics
   */
  public async getSubgraphErrorRateMetrics({
    dateRange,
    granule,
    organizationId,
    subgraphId,
    whereSql,
    queryParams,
  }: GetSubgraphMetricsProps) {
    flipDateRangeValuesIfNeeded(dateRange);

    // get requests in last [range] hours in series of [step]
    const series = await this.client.queryPromise<{ timestamp: string; requestRate: string; errorRate: string }>(
      `
      WITH
        toStartOfInterval(toDateTime('${dateRange.start}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${dateRange.end}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          round(sum(TotalRequests) / ${granule}, 4) AS requestRate,
          round(sum(TotalErrors) / ${granule}, 4) AS errorRate
      FROM ${this.client.database}.subgraph_request_metrics_5_30
      WHERE timestamp >= startDate AND timestamp <= endDate
        AND OrganizationID = '${organizationId}'
        AND SubgraphID = '${subgraphId}'
        ${whereSql ? `AND ${whereSql}` : ''}
      GROUP BY timestamp
      ORDER BY timestamp ASC WITH FILL FROM
        toStartOfInterval(toDateTime('${dateRange.start}'), INTERVAL ${granule} MINUTE)
      TO
        toDateTime('${dateRange.end}')
      STEP INTERVAL ${granule} MINUTE
    `,
      queryParams,
    );

    return {
      data: {
        series: series.map((s) => {
          return {
            timestamp: String(new Date(s.timestamp + 'Z').getTime()),
            requestRate: Number.parseFloat(s.requestRate),
            errorRate: Number.parseFloat(s.errorRate),
          };
        }),
      },
    };
  }

  public async getSubgraphMetricsView(props: GetSubgraphMetricsViewProps) {
    const metricsProps = this.getSubgraphMetricsProps(props);

    const [requests, latency, errors, filters] = await Promise.all([
      this.getSubgraphRequestRateMetrics(metricsProps),
      this.getSubgraphLatencyMetrics(metricsProps),
      this.getSubgraphErrorMetrics(metricsProps),
      this.getSubgraphMetricFilters(metricsProps),
    ]);

    return {
      resolution: metricsProps.granule,
      requests: requests.data,
      latency: latency.data,
      errors: errors.data,
      filters,
    };
  }

  public async getSubgraphErrorsView(props: GetSubgraphMetricsViewProps) {
    const metricsProps = this.getSubgraphMetricsProps(props);

    const [errorRate] = await Promise.all([this.getSubgraphErrorRateMetrics(metricsProps)]);

    return {
      resolution: metricsProps.granule,
      errorRate: errorRate.data,
    };
  }

  protected getSubgraphMetricsProps(props: GetSubgraphMetricsViewProps): GetSubgraphMetricsProps {
    const {
      range,
      dateRange,
      filters: selectedFilters,
      organizationId,
      subgraphId,
      subgraphLabels,
      namespaceId,
    } = props;

    if (dateRange && dateRange.start > dateRange.end) {
      const tmp = dateRange.start;
      dateRange.start = dateRange.end;
      dateRange.end = tmp;
    }

    const parsedDateRange = isoDateRangeToTimestamps(dateRange, range);
    const [start, end] = getDateRange(parsedDateRange);

    // diff in hours
    const diff = (parsedDateRange.end - parsedDateRange.start) / 60 / 60 / 1000;
    const granule = getGranularity(diff);

    const [prevStart, prevEnd] = getDateRange(parsedDateRange, diff);

    const coercedFilters = coerceFilterValues({}, selectedFilters, this.baseFilters);

    const { whereSql } = buildCoercedFilterSqlStatement({}, coercedFilters.result, coercedFilters.filterMapper, false);

    escapeStringsFromParams(coercedFilters.result);

    return {
      granule,
      rangeInHours: diff,
      dateRange: {
        start,
        end,
      },
      prevDateRange: {
        start: prevStart,
        end: prevEnd,
      },
      organizationId,
      subgraphId,
      subgraphLabels,
      namespaceId,
      whereSql,
      queryParams: coercedFilters.result,
    };
  }

  private baseFilters: BaseFilters = {
    operationName: {
      dbField: 'OperationName',
      dbClause: 'where',
      columnName: 'operationName',
      title: 'Operation Name',
      options: [],
    },
    operationHash: {
      dbField: 'OperationHash',
      dbClause: 'where',
      columnName: 'operationHash',
      title: 'Operation Hash',
      options: [],
      customOptions: CustomOptions.Text,
    },
    operationPersistedId: {
      dbField: 'OperationPersistedID',
      dbClause: 'where',
      columnName: 'operationPersistedId',
      title: 'Operation Persisted ID',
      options: [],
      customOptions: CustomOptions.Text,
    },
    clientName: {
      dbField: 'ClientName',
      dbClause: 'where',
      columnName: 'clientName',
      title: 'Client Name',
      options: [],
    },
    clientVersion: {
      dbField: 'ClientVersion',
      dbClause: 'where',
      columnName: 'clientVersion',
      title: 'Client Version',
      options: [],
    },
    federatedGraphId: {
      dbField: 'FederatedGraphID',
      dbClause: 'where',
      columnName: 'federatedGraphId',
      title: 'Federated Graph',
      options: [],
    },
  };

  public async getSubgraphMetricFilters({
    dateRange,
    organizationId,
    subgraphId,
    subgraphLabels,
    namespaceId,
  }: GetSubgraphMetricsProps) {
    const filters = { ...this.baseFilters };
    flipDateRangeValuesIfNeeded(dateRange);

    const query = `
      WITH
        toDateTime('${dateRange.start}') AS startDate,
        toDateTime('${dateRange.end}') AS endDate
      SELECT
        OperationName as operationName,
        ClientName as clientName,
        ClientVersion as clientVersion
      FROM ${this.client.database}.subgraph_request_metrics_5_30
      WHERE Timestamp >= startDate AND Timestamp <= endDate
        AND OrganizationID = '${organizationId}'
        AND SubgraphID = '${subgraphId}'
      GROUP BY OperationName, ClientName, ClientVersion
    `;

    const res = await this.client.queryPromise(query);

    // filterLabelis the label for the values of the filters
    // for ex:- the federatedGraphId filter will have "slug" as the label and the id as the value
    const addFilterOption = (filter: string, value: string, filterLabel?: string) => {
      if (!filters[filter].options) {
        filters[filter].options = [];
      }

      let label = filterLabel || value;
      if (filter === 'clientVersion' && value === 'missing') {
        label = 'missing';
      } else if (filter === 'clientName' && value === 'unknown') {
        label = 'unknown';
      }

      filters[filter].options.push({
        label,
        operator: AnalyticsViewFilterOperator.EQUALS,
        value,
      });
    };

    const filterNames = Object.keys(filters);
    const filterOptions: Record<string, string[]> = {};

    for (const row of res) {
      for (const filterName of filterNames) {
        if (row[filterName] !== undefined && !filterOptions[filterName]?.includes(row[filterName])) {
          filterOptions[filterName] = filterOptions[filterName] || [];
          filterOptions[filterName].push(row[filterName]);
          addFilterOption(filterName, row[filterName]);
        }
      }
    }

    const fedRepo = new FederatedGraphRepository(this.logger, this.db, organizationId);
    const graphs = await fedRepo.bySubgraphLabels({ labels: subgraphLabels, namespaceId });
    for (const graph of graphs) {
      addFilterOption('federatedGraphId', graph.id, graph.name);
    }

    return buildAnalyticsViewFilters(
      {
        operationName: '',
        operationHash: '',
        operationPersistedId: '',
        clientName: '',
        clientVersion: '',
        federatedGraphId: '',
      },
      filters,
    );
  }

  /**
   * Merges series and previous series into one array, @todo could be handled in query directly.
   * @param diff
   * @param series
   * @param previousSeries
   * @returns
   */
  protected mapSeries(diff: number, series: LatencySeries[] = [], previousSeries?: LatencySeries[]) {
    return series.map((s) => {
      const timestamp = new Date(s.timestamp + 'Z').getTime();
      const prevTimestamp = toISO9075(new Date(timestamp - diff * 60 * 60 * 1000));
      const prevValue = previousSeries?.find((s) => s.timestamp === prevTimestamp)?.value ?? '0';

      return {
        timestamp: String(timestamp),
        value: String(s.value),
        previousValue: String(Number.parseFloat(prevValue)),
        p50: s.p50 === undefined ? undefined : String(s.p50),
        p90: s.p90 === undefined ? undefined : String(s.p90),
        p99: s.p99 === undefined ? undefined : String(s.p99),
      };
    });
  }
}
