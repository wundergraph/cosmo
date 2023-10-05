import { ClickHouseClient } from 'src/core/clickhouse/index.js';
import { QueryResultType, Response } from 'src/core/prometheus/types.js';

const getEndDate = () => {
  const now = new Date();

  now.setSeconds(59);
  now.setMilliseconds(999);

  return Math.round(now.getTime() / 1000) * 1000;
};

// parse a Date to ISO9075 format in UTC, as used by Clickhouse
const toISO9075 = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const getUnixTimeInSeconds = (timestamp: Date | number, offset?: number) => {
  let date: number;
  if (timestamp instanceof Date) {
    date = timestamp.getTime();
  } else {
    date = timestamp;
  }

  if (offset) {
    date = date - offset * 60 * 60 * 1000;
  }

  return Math.round(date / 1000);
};

const getDateRange = (endDate: Date | number, range: number, offset = 0) => {
  const start = getUnixTimeInSeconds(endDate, range + offset);
  const end = getUnixTimeInSeconds(endDate, offset);

  return [start, end];
};

const getGranularity = (range: number) => {
  switch (range) {
    case 168: {
      // 7 days
      return '240'; // 4H
    }
    case 72: {
      // 3 days
      return '60'; // 60 min
    }
    case 48: {
      // 2 days
      return '15'; // 15min
    }
    case 24: {
      // 1 day
      return '15'; // 15m
    }
    case 4: {
      return '5'; // 10m
    }
    case 1: {
      // 1 hour
      return '5'; // 5m
    }
  }

  return '5';
};

const parseValue = (value?: string | number | null) => {
  if (typeof value === 'number') {
    return String(value);
  }
  return value || '0';
};

interface MetricsParams {
  organizationId: string;
  graphId: string;
  graphName: string;
}

interface GetMetricsProps {
  range?: number;
  endDate?: number;
  params: MetricsParams;
}

export class MetricsDashboardRepository {
  constructor(private chClient: ClickHouseClient) {}

  protected async getResponses<Queries extends Promise<Response<QueryResultType.Scalar | QueryResultType.Matrix>>[]>(
    ...queries: Queries
  ) {
    const responses = await Promise.allSettled(queries);

    return responses.map((r) => {
      if (r.status === 'rejected') {
        return {
          error: {
            type: r.status,
            message: r.reason,
          },
        };
      }

      return {
        data: r.value,
      };
    });
  }

  /**
   * Get request rate metrics
   */
  public async getRequestRateMetrics({ range = 24, endDate = getEndDate(), params }: GetMetricsProps) {
    const granule = getGranularity(range);

    const [start, end] = getDateRange(endDate, range);
    const [prevStart, prevEnd] = getDateRange(endDate, range, range);

    const multiplier = range * 60;

    // get total request rate in last [range]h
    const queryRate = (start: number, end: number) => {
      return this.chClient.queryPromise<{ value: number | null }>(`
        SELECT round(sum(total) / ${multiplier}, 4) AS value FROM (
        SELECT
          toDateTime('${start}') AS startDate,
          toDateTime('${end}') AS endDate,
          sum(TotalRequests) AS total
        FROM operation_request_metrics_5_30_mv
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${params.organizationId}'
          AND FederatedGraphID = '${params.graphId}'
        GROUP BY Timestamp 
      )
    `);
    };
    const medianRate = queryRate(start, end);
    const prevMedianRate = queryRate(prevStart, prevEnd);

    // get top 5 operations in last [range] hours
    const top5 = this.chClient.queryPromise<{ name: string; value: string }>(`
      WITH
        toDateTime('${start}') AS startDate,
        toDateTime('${end}') AS endDate
      SELECT name, round(sum(total) / ${multiplier}, 4) AS value FROM (
        SELECT
          Timestamp as timestamp,
        OperationName as name,
          sum(TotalRequests) as total
        FROM operation_request_metrics_5_30_mv
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${params.organizationId}'
          AND FederatedGraphID = '${params.graphId}'
        GROUP BY Timestamp, OperationName 
      ) GROUP BY name ORDER BY value DESC LIMIT 5
    `);

    // get time series of last [range] hours
    const querySeries = (start: number, end: number) => {
      return this.chClient.queryPromise<{ value: number | null }[]>(`
      WITH
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          round(sum(TotalRequests) / ${granule}, 4) AS value
      FROM operation_request_metrics_5_30_mv
      WHERE timestamp >= startDate AND timestamp <= endDate
        AND OrganizationID = '${params.organizationId}'
        AND FederatedGraphID = '${params.graphId}'
      GROUP BY timestamp
      ORDER BY timestamp ASC WITH FILL FROM 
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE)
      TO
        toDateTime('${end}')
      STEP INTERVAL ${granule} minute
    `);
    };

    const series = querySeries(start, end);
    const prevSeries = querySeries(prevStart, prevEnd);

    const [medianResponse, prevMedianResponse, top5Response, seriesResponse, prevSeriesResponse] = await Promise.all([
      medianRate,
      prevMedianRate,
      top5,
      series,
      prevSeries,
    ]);

    return {
      data: {
        value: parseValue(medianResponse[0]?.value),
        previousValue: parseValue(prevMedianResponse[0]?.value),
        top: top5Response.map((v) => ({
          name: v.name,
          value: parseValue(v.value),
        })),
        series: this.mapSeries(range, seriesResponse, prevSeriesResponse),
      },
    };
  }

  /**
   * Get latency metrics
   */
  public async getLatencyMetrics({ range = 24, endDate = getEndDate(), params }: GetMetricsProps) {
    const granule = getGranularity(range);

    const [start, end] = getDateRange(endDate, range);
    const [prevStart, prevEnd] = getDateRange(endDate, range, range);

    const queryLatency = (quantile: string, start: number, end: number) => {
      return this.chClient.queryPromise<{ value: number }>(`
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
        FROM operation_latency_metrics_5_30_mv
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${params.organizationId}'
          AND FederatedGraphID = '${params.graphId}'
    `);
    };

    const p95 = queryLatency('0.95', start, end);
    const prevP95 = queryLatency('0.95', prevStart, prevEnd);

    // get top 5 operations in last [range] hours
    const queryTop5 = (quantile: string, start: number, end: number) => {
      return this.chClient.queryPromise<{ name: string; value: string }>(`
        WITH
          toDateTime('${start}') AS startDate,
          toDateTime('${end}') AS endDate
        SELECT
          OperationName as name,
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
        FROM operation_latency_metrics_5_30_mv
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${params.organizationId}'
          AND FederatedGraphID = '${params.graphId}'
        GROUP BY OperationName ORDER BY value DESC LIMIT 5
    `);
    };

    const top5 = queryTop5('0.95', start, end);

    // get time series of last [range] hours
    const querySeries = (quantile: string, start: number, end: number) => {
      return this.chClient.queryPromise<{ value: number | null }[]>(`
        WITH
          toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE) AS startDate,
          toDateTime('${end}') AS endDate
        SELECT
            toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
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
        FROM operation_latency_metrics_5_30_mv
        WHERE timestamp >= startDate AND timestamp <= endDate
          AND OrganizationID = '${params.organizationId}'
          AND FederatedGraphID = '${params.graphId}'
        GROUP BY timestamp, ExplicitBounds
        ORDER BY timestamp ASC WITH FILL FROM
          toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE)
        TO
          toDateTime('${end}')
        STEP INTERVAL ${granule} minute
      `);
    };

    const series = querySeries('0.95', start, end);
    const prevSeries = querySeries('0.95', prevStart, prevEnd);

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
        top: top5Response.map((v: any) => ({
          name: v.name,
          value: parseValue(v.value),
        })),
        series: this.mapSeries(range, seriesResponse, prevSeriesResponse),
      },
    };
  }

  /**
   * Get error metrics
   */
  public async getErrorMetrics({ range = 24, endDate = getEndDate(), params }: GetMetricsProps) {
    const granule = getGranularity(range);

    const [start, end] = getDateRange(endDate, range);
    const [prevStart, prevEnd] = getDateRange(endDate, range, range);

    // get median request rate in last [range]h
    const queryPercentage = (start: number, end: number) => {
      return this.chClient.queryPromise<{ errorPercentage: number }>(`
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
          FROM operation_request_metrics_5_30_mv
          WHERE Timestamp >= startDate AND Timestamp <= endDate
            AND OrganizationID = '${params.organizationId}'
            AND FederatedGraphID = '${params.graphId}'
          GROUP BY Timestamp, OperationName 
        )
    `);
    };

    const value = queryPercentage(start, end);
    const prevValue = queryPercentage(prevStart, prevEnd);

    // get top 5 operations in last [range] hours
    const top5 = this.chClient.queryPromise<{ name: string; value: string }>(`
      WITH
        toDateTime('${start}') AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
        name,
        median(errorPercentage) as value
      FROM (
        SELECT
          Timestamp as timestamp,
          OperationName as name,
          sum(TotalRequests) as totalRequests,
          sum(TotalErrors) as totalErrors,
          if(totalErrors > 0, round(totalErrors / totalRequests * 100, 2), 0) AS errorPercentage
        FROM operation_request_metrics_5_30_mv
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${params.organizationId}'
          AND FederatedGraphID = '${params.graphId}'
        GROUP BY Timestamp, OperationName 
      ) GROUP BY name ORDER BY value DESC LIMIT 5
    `);

    // get time series of last [range] hours
    const getSeries = (start: number, end: number) => {
      return this.chClient.queryPromise<{ value: number | null }[]>(`
      WITH
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          sum(TotalErrors) AS errors,
          sum(TotalRequests) AS requests,
          if(errors > 0, round(errors / requests * 100, 2), 0) AS value
      FROM operation_request_metrics_5_30_mv
      WHERE timestamp >= startDate AND timestamp <= endDate
        AND OrganizationID = '${params.organizationId}'
        AND FederatedGraphID = '${params.graphId}'
      GROUP BY timestamp
      ORDER BY timestamp ASC WITH FILL FROM 
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE)
      TO
        toDateTime('${end}')
      STEP INTERVAL ${granule} minute
    `);
    };

    const series = getSeries(start, end);
    const prevSeries = getSeries(prevStart, prevEnd);

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
          name: v.name,
          value: parseValue(v.value),
        })),
        series: this.mapSeries(range, seriesResponse, prevSeriesResponse),
      },
    };
  }

  /**
   * Get error rate metrics
   */
  public async getErrorRateMetrics({
    range = 24,
    endDate = getEndDate(),
    params,
  }: {
    range?: number;
    endDate?: number;
    params: MetricsParams;
  }) {
    const granule = getGranularity(range);

    const [start, end] = getDateRange(endDate, range);

    // get requests in last [range] hours in series of [step]
    const series = await this.chClient.queryPromise<{ timestamp: string; requestRate: string; errorRate: string }>(`
      WITH
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          round(sum(TotalRequests) / ${granule}, 4) AS requestRate,
          round(sum(TotalErrors) / ${granule}, 4) AS errorRate
      FROM operation_request_metrics_5_30_mv
      WHERE timestamp >= startDate AND timestamp <= endDate
        AND OrganizationID = '${params.organizationId}'
        AND FederatedGraphID = '${params.graphId}'
      GROUP BY timestamp
      ORDER BY timestamp ASC WITH FILL FROM
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE)
      TO
        toDateTime('${end}')
      STEP INTERVAL ${granule} MINUTE
    `);

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

  /**
   * Merges series and previous series into one array, @todo could be handled in query directly.
   * @param range
   * @param series
   * @param previousSeries
   * @returns
   */
  protected mapSeries(range: number, series: any[] = [], previousSeries?: any[]) {
    return series.map((s) => {
      const timestamp = new Date(s.timestamp + 'Z').getTime();
      const prevTimestamp = toISO9075(new Date(timestamp - range * 60 * 60 * 1000));

      return {
        timestamp: String(timestamp),
        value: String(s.value),
        previousValue: String(
          Number.parseFloat(previousSeries?.find((s) => s.timestamp === prevTimestamp)?.value || '0'),
        ),
      };
    });
  }
}
