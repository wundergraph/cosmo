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
      } else if (r.status === 'fulfilled' && r.value.status === 'error') {
        return {
          error: {
            type: r.value.errorType,
            message: r.value.error,
            warnings: r.value.warnings,
          },
        };
      }
      return {
        data: r.value.data,
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

    // get median request rate in last [range]h
    const medianRate = this.chClient.queryPromise<{ medianRate: number | null }>(`
      SELECT round(quantileDeterministic(0.5)(rate, 1) / 60, 4) AS medianRate FROM (
        SELECT
          toDateTime('${start}') AS startDate,
          toDateTime('${end}') AS endDate,
          sum(TotalRequests) / 5 AS rate
        FROM operation_request_metrics_5_30_mv
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${params.organizationId}'
          AND FederatedGraphID = '${params.graphId}'
        GROUP BY Timestamp, OperationName 
      )
    `);

    const prevMedianRate = this.chClient.queryPromise<{ medianRate: number | null }>(`
      SELECT round(quantileDeterministic(0.5)(rate, 1) / 60, 4) AS medianRate FROM (
        SELECT
          toDateTime('${prevStart}') AS startDate,
          toDateTime('${prevEnd}') AS endDate,
          sum(TotalRequests) / 5 AS rate
        FROM operation_request_metrics_5_30_mv
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${params.organizationId}'
          AND FederatedGraphID = '${params.graphId}'
        GROUP BY Timestamp, OperationName 
      )
    `);

    // get top 5 operations in last [range] hours
    const top5 = this.chClient.queryPromise<{ name: string; value: string }>(`
      WITH
        toDateTime('${start}') AS startDate,
        toDateTime('${end}') AS endDate
      SELECT name, round(quantileDeterministic(0.5)(rate, 1) / 60, 4) AS value FROM (
        SELECT
          Timestamp as timestamp,
        OperationName as name,
          sum(TotalRequests) / 5 as rate
        FROM operation_request_metrics_5_30_mv
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${params.organizationId}'
          AND FederatedGraphID = '${params.graphId}'
        GROUP BY Timestamp, OperationName 
      ) GROUP BY name ORDER BY value DESC LIMIT 5
    `);

    // get time series of last [range] hours
    const series = await this.chClient.queryPromise<{ value: number | null }[]>(`
      WITH
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          round(sum(TotalRequests) / 5, 4) AS value
      FROM operation_request_metrics_5_30_mv
      WHERE timestamp >= startDate AND timestamp <= endDate
        AND OrganizationID = '${params.organizationId}'
        AND FederatedGraphID = '${params.graphId}'
      GROUP BY timestamp, OperationName
      ORDER BY timestamp ASC WITH FILL FROM 
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE)
      TO
        toDateTime('${end}')
      STEP INTERVAL ${granule} minute
    `);

    const prevSeries = await this.chClient.queryPromise<{ value: number | null }[]>(`
      WITH
        toStartOfInterval(toDateTime('${prevStart}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${prevEnd}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          round(sum(TotalRequests) / 5, 4) AS value
      FROM operation_request_metrics_5_30_mv
      WHERE timestamp >= startDate AND timestamp <= endDate
        AND OrganizationID = '${params.organizationId}'
        AND FederatedGraphID = '${params.graphId}'
      GROUP BY timestamp, OperationName
      ORDER BY timestamp ASC WITH FILL FROM 
        toStartOfInterval(toDateTime('${prevStart}'), INTERVAL ${granule} MINUTE)
      TO
        toDateTime('${prevEnd}')
      STEP INTERVAL ${granule} minute
    `);

    const [medianResponse, prevMedianResponse, top5Response, seriesResponse, prevSeriesResponse] = await Promise.all([
      medianRate,
      prevMedianRate,
      top5,
      series,
      prevSeries,
    ]);

    return {
      data: {
        value: parseValue(medianResponse[0]?.medianRate),
        previousValue: parseValue(prevMedianResponse[0]?.medianRate),
        top: top5Response.map((v) => ({
          name: v.name,
          value: parseValue(v.value),
        })),
        series: this.mapSeries(range, seriesResponse, prevSeriesResponse),
      },
    } as any;
  }

  /**
   * Get latency metrics
   */
  public async getLatencyMetrics({ range = 24, endDate = getEndDate(), params }: GetMetricsProps) {
    const granule = getGranularity(range);

    const [start, end] = getDateRange(endDate, range);
    const [prevStart, prevEnd] = getDateRange(endDate, range, range);

    const p95 = await this.chClient.queryPromise<{ p95: number }>(`
      WITH
      toDateTime('${start}') AS startDate,
      toDateTime('${end}') AS endDate
      SELECT
       quantilesMerge(0.95)(DurationQuantiles)[1] AS p95
      FROM operation_latency_metrics_5_30_mv
      WHERE Timestamp >= startDate AND Timestamp <= endDate
        AND OrganizationID = '${params.organizationId}'
        AND FederatedGraphID = '${params.graphId}'
    `);

    const prevP95 = await this.chClient.queryPromise<{ p95: number }>(`
      WITH
      toDateTime('${prevStart}') AS startDate,
      toDateTime('${prevEnd}') AS endDate
      SELECT
      quantilesMerge(0.95)(DurationQuantiles)[1] AS p95
      FROM operation_latency_metrics_5_30_mv
      WHERE Timestamp >= startDate AND Timestamp <= endDate
        AND OrganizationID = '${params.organizationId}'
        AND FederatedGraphID = '${params.graphId}'
    `);

    // get top 5 operations in last [range] hours
    const top5 = this.chClient.queryPromise<{ name: string; value: string }>(`
      WITH
        toDateTime('${start}') AS startDate,
        toDateTime('${end}') AS endDate
      SELECT name, round(quantileDeterministic(0.5)(p95, 1), 4) AS value FROM (
        SELECT
          Timestamp as timestamp,
          OperationName as name,
          quantilesMerge(0.95)(DurationQuantiles)[1] AS p95
        FROM operation_latency_metrics_5_30_mv
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${params.organizationId}'
          AND FederatedGraphID = '${params.graphId}'
        GROUP BY Timestamp, OperationName 
      ) GROUP BY name ORDER BY value DESC LIMIT 5
    `);

    // get time series of last [range] hours
    const series = await this.chClient.queryPromise<{ value: number | null }[]>(`
      WITH
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          quantilesMerge(0.95)(DurationQuantiles)[1] AS value
      FROM operation_latency_metrics_5_30_mv
      WHERE timestamp >= startDate AND timestamp <= endDate
        AND OrganizationID = '${params.organizationId}'
        AND FederatedGraphID = '${params.graphId}'
      GROUP BY timestamp, OperationName
      ORDER BY timestamp ASC WITH FILL FROM 
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE)
      TO
        toDateTime('${end}')
      STEP INTERVAL ${granule} minute
    `);

    const prevSeries = await this.chClient.queryPromise<{ value: number | null }[]>(`
      WITH
        toStartOfInterval(toDateTime('${prevStart}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${prevEnd}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          quantilesMerge(0.95)(DurationQuantiles)[1] AS value
      FROM operation_latency_metrics_5_30_mv
      WHERE timestamp >= startDate AND timestamp <= endDate
        AND OrganizationID = '${params.organizationId}'
        AND FederatedGraphID = '${params.graphId}'
      GROUP BY timestamp, OperationName
      ORDER BY timestamp ASC WITH FILL FROM 
        toStartOfInterval(toDateTime('${prevStart}'), INTERVAL ${granule} MINUTE)
      TO
        toDateTime('${prevEnd}')
      STEP INTERVAL ${granule} minute
    `);

    // const responses = await this.getResponses(p95, prevP95, top5, series, prevSeries);
    const [p95Response, prevP95Response, top5Response, seriesResponse, prevSeriesResponse] = await Promise.all([
      p95,
      prevP95,
      top5,
      series,
      prevSeries,
    ]);

    return (await {
      data: {
        value: parseValue(p95Response[0].p95),
        previousValue: parseValue(prevP95Response[0].p95),
        top: top5Response.map((v) => ({
          name: v.name,
          value: parseValue(v.value),
        })),
        series: this.mapSeries(range, seriesResponse, prevSeriesResponse),
      },
      errors: [],
    }) as any;
  }

  /**
   * Get error metrics
   */
  public async getErrorMetrics({ range = 24, endDate = getEndDate(), params }: GetMetricsProps) {
    const granule = getGranularity(range);

    const [start, end] = getDateRange(endDate, range);
    const [prevStart, prevEnd] = getDateRange(endDate, range, range);

    // get median request rate in last [range]h
    const value = this.chClient.queryPromise<{ errorPercentage: number }>(`
      WITH
        toDateTime('${start}') AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
        sum(totalErrors) AS serverErrors,
        sum(totalClientErrors) as clientErrors,
        sum(totalRequests) AS requests,
        round(serverErrors + clientErrors, 3) as errors,
        if(errors > 0, round(errors / requests * 100, 2), 0) AS errorPercentage FROM (
        SELECT
          sum(TotalRequests) as totalRequests,
          sum(TotalErrors) as totalErrors,
          sum(TotalClientErrors) as totalClientErrors
        FROM operation_request_metrics_5_30_mv
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${params.organizationId}'
          AND FederatedGraphID = '${params.graphId}'
        GROUP BY Timestamp, OperationName 
      )
    `);

    const prevValue = this.chClient.queryPromise<{ errorPercentage: number | null }>(`
      WITH
        toDateTime('${prevStart}') AS startDate,
        toDateTime('${prevEnd}') AS endDate
      SELECT
        sum(totalErrors) AS serverErrors,
        sum(totalClientErrors) as clientErrors,
        sum(totalRequests) AS requests,
        round(serverErrors + clientErrors, 3) as errors,
        if(errors > 0, round(errors / requests * 100, 2), 0) AS errorPercentage FROM (
        SELECT
          sum(TotalRequests) as totalRequests,
          sum(TotalErrors) as totalErrors,
          sum(TotalClientErrors) as totalClientErrors
        FROM operation_request_metrics_5_30_mv
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${params.organizationId}'
          AND FederatedGraphID = '${params.graphId}'
        GROUP BY Timestamp, OperationName 
      )
    `);

    // get top 5 operations in last [range] hours
    const top5 = this.chClient.queryPromise<{ name: string; value: string }>(`
      WITH
        toDateTime('${start}') AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
        name,
        sum(totalErrors) AS serverErrors,
        sum(totalClientErrors) as clientErrors,
        sum(totalRequests) AS requests,
        round(serverErrors + clientErrors, 3) as errors,
        if(errors > 0, round(errors / requests * 100, 2), 0) AS value
      FROM (
        SELECT
          Timestamp as timestamp,
          OperationName as name,
          sum(TotalRequests) as totalRequests,
          sum(TotalErrors) as totalErrors,
          sum(TotalClientErrors) as totalClientErrors
        FROM operation_request_metrics_5_30_mv
        WHERE Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = '${params.organizationId}'
          AND FederatedGraphID = '${params.graphId}'
        GROUP BY Timestamp, OperationName 
      ) GROUP BY name ORDER BY value DESC LIMIT 5
    `);

    // get time series of last [range] hours
    const series = this.chClient.queryPromise<{ value: number | null }[]>(`
      WITH
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          sum(TotalErrors) AS serverErrors,
          sum(TotalClientErrors) as clientErrors,
          sum(TotalRequests) AS requests,
          round(serverErrors + clientErrors, 3) as errors,
          if(errors > 0, round(errors / requests * 100, 2), 0) AS value
      FROM operation_request_metrics_5_30_mv
      WHERE timestamp >= startDate AND timestamp <= endDate
        AND OrganizationID = '${params.organizationId}'
        AND FederatedGraphID = '${params.graphId}'
      GROUP BY timestamp, OperationName
      ORDER BY timestamp ASC WITH FILL FROM 
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE)
      TO
        toDateTime('${end}')
      STEP INTERVAL ${granule} minute
    `);

    const prevSeries = this.chClient.queryPromise<{ value: number | null }[]>(`
      WITH
        toStartOfInterval(toDateTime('${prevStart}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${prevEnd}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          sum(TotalErrors) AS serverErrors,
          sum(TotalClientErrors) as clientErrors,
          sum(TotalRequests) AS requests,
          round(serverErrors + clientErrors, 3) as errors,
          if(errors > 0, round(errors / requests * 100, 2), 0) AS value
      FROM operation_request_metrics_5_30_mv
      WHERE timestamp >= startDate AND timestamp <= endDate
        AND OrganizationID = '${params.organizationId}'
        AND FederatedGraphID = '${params.graphId}'
      GROUP BY timestamp, OperationName
      ORDER BY timestamp ASC WITH FILL FROM
        toStartOfInterval(toDateTime('${prevStart}'), INTERVAL ${granule} MINUTE)
      TO
        toDateTime('${prevEnd}')
      STEP INTERVAL ${granule} MINUTE
    `);

    const [valueResponse, prevValueResponse, top5Response, seriesResponse, prevSeriesResponse] = await Promise.all([
      value,
      prevValue,
      top5,
      series,
      prevSeries,
    ]);

    return (await {
      data: {
        value: parseValue(valueResponse[0].errorPercentage),
        previousValue: parseValue(prevValueResponse[0].errorPercentage),
        top: top5Response.map((v) => ({
          name: v.name,
          value: parseValue(v.value),
        })),
        series: this.mapSeries(range, seriesResponse, prevSeriesResponse),
      },
    }) as any;
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
    const series = await this.chClient.queryPromise<{ timestamp: string; requestRate: number; errorRate: number }>(`
      WITH
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          round(sum(TotalRequests) / 5, 4) AS requestRate,
          round(sum(TotalErrors) + sum(TotalClientErrors) / 5, 4) AS errorRate
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

    return await {
      data: {
        series: series.map((s) => {
          return {
            timestamp: String(new Date(s.timestamp + 'Z').getTime()),
            requestRate: s.requestRate,
            errorRate: s.errorRate,
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
