import PrometheusClient from 'src/core/prometheus/client.js';
import { QueryResultType, Response } from 'src/core/prometheus/types.js';

const getUtcUnixTime = () => {
  const now = new Date();
  return Math.floor(now.getTime() / 1000) * 1000;
};

const getStep = (range: number) => {
  switch (range) {
    case 168: {
      // 7 days
      return '1h';
    }
    case 72: {
      // 3 days
      return '30m';
    }
    case 48: {
      // 2 days
      return '15m';
    }
    case 24: {
      // 1 day
      return '300';
    }
    case 1: {
      // 1 hour
      return '1m';
    }
  }

  return '1h';
};

const createTimeRange = (endDate: number, rangeInHours: number): Array<{ timestamp: string }> => {
  const range = [];

  const startTimestamp = endDate;

  let step = 60;
  switch (rangeInHours) {
    case 168: {
      step = 60;
      break;
    }
    case 72: {
      step = 30;
      break;
    }
    case 48: {
      step = 15;
      break;
    }
    case 24: {
      step = 5;
      break;
    }
    case 1: {
      step = 60;
      break;
    }
  }

  const x = (60 / step) * rangeInHours;

  for (let i = 0; i <= x; i++) {
    range.unshift({
      timestamp: String(startTimestamp - i * step * 60 * 1000),
    });
  }

  return range;
};

interface GetRangeQueryPropsOptions {
  /**
   * Range in hours
   */
  range: number;
  /**
   * End date in milliseconds
   */
  endDate: number;
}

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
  constructor(private client: PrometheusClient) {}

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
  public async getRequestRateMetrics({ range = 24, endDate = getUtcUnixTime(), params }: GetMetricsProps) {
    const prange = '15m';

    // get median of requests in last [range] hours
    const median = this.client.query({
      query: `quantile(0.5, sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}}[${range}h])) * 60)`,
    });

    const prevMedian = this.client.query({
      query: `quantile(0.5, sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}}[${range}h] offset ${range}h)) * 60)`,
    });

    // get top 5 operations in last [range] hours
    const top5 = this.client.query({
      query: `topk(5, sum by (wg_operation_name) (rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}}[${range}h])) * 60)`,
    });

    // get requests in last [range] hours in series of [step]
    const series = this.client.queryRange({
      query: `sum (rate(cosmo_router_http_requests_total{${this.getQueryLabels(params)}}[${prange}]) * 60)`,
      ...this.getRangeQueryProps({
        range,
        endDate,
      }),
    });

    const prevSeries = this.client.queryRange({
      query: `sum (rate(cosmo_router_http_requests_total{${this.getQueryLabels(params)}}[${prange}]) * 60)`,
      ...this.getRangeQueryProps({
        range,
        endDate: endDate - range * 60 * 60 * 1000,
      }),
    });

    const responses = await this.getResponses(median, prevMedian, top5, series, prevSeries);
    const [medianResponse, prevMedianResponse, top5Response, seriesResponse, prevSeriesResponse] = responses;

    return {
      data: {
        value: medianResponse.data?.result[0]?.value[1] || '0',
        previousValue: prevMedianResponse.data?.result[0]?.value[1] || '0',
        top:
          top5Response.data?.result?.map((v: any) => ({
            name: v.metric.wg_operation_name || 'unknown',
            value: v.value[1] || '0',
          })) || [],
        series: this.mapSeries(
          endDate,
          range,
          seriesResponse.data?.result[0]?.values,
          prevSeriesResponse.data?.result[0]?.values,
        ),
      },
      errors: responses.filter((r) => r.error),
    };
  }

  /**
   * Get latency metrics
   */
  public async getLatencyMetrics({ range = 24, endDate = getUtcUnixTime(), params }: GetMetricsProps) {
    const prange = '15m';

    // get p95 of requests in last [range] hours
    const p95 = this.client.query({
      query: `histogram_quantile(0.95, sum(rate(cosmo_router_http_request_duration_milliseconds_bucket{${this.getQueryLabels(
        params,
      )}}[${range}h])) by (le))`,
    });

    const prevP95 = this.client.query({
      query: `histogram_quantile(0.95, sum(rate(cosmo_router_http_request_duration_milliseconds_bucket{${this.getQueryLabels(
        params,
      )}}[${range}h] offset ${range}h)) by (le))`,
    });

    // get top 5 operations in last [range] hours
    const top5 = this.client.query({
      query: `topk(5, sum by (wg_operation_name) (rate(cosmo_router_http_request_duration_milliseconds_bucket{${this.getQueryLabels(
        params,
      )}}[${range}h])))`,
    });

    // get p95 latency [range] hours in series of [step]
    const series = this.client.queryRange({
      query: `histogram_quantile(0.95, sum(rate(cosmo_router_http_request_duration_milliseconds_bucket{${this.getQueryLabels(
        params,
      )}}[${prange}])) by (le))`,
      ...this.getRangeQueryProps({
        range,
        endDate,
      }),
    });

    const prevSeries = this.client.queryRange({
      query: `histogram_quantile(0.95, sum(rate(cosmo_router_http_request_duration_milliseconds_bucket{${this.getQueryLabels(
        params,
      )}}[${prange}] offset ${range}h)) by (le))`,
      ...this.getRangeQueryProps({
        range,
        endDate: endDate - range * 60 * 60 * 1000,
      }),
    });

    const responses = await this.getResponses(p95, prevP95, top5, series, prevSeries);
    const [p95Response, prevP95Response, top5Response, seriesResponse, prevSeriesResponse] = responses;

    return {
      data: {
        value: p95Response.data?.result[0]?.value[1] || '0',
        previousValue: prevP95Response.data?.result[0]?.value[1] || '0',
        top:
          top5Response.data?.result.map((v: any) => ({
            name: v.metric.wg_operation_name || 'unknown',
            value: v.value[1] || '0',
          })) || [],
        series: this.mapSeries(
          endDate,
          range,
          seriesResponse.data?.result[0].values,
          prevSeriesResponse.data?.result[0]?.values,
        ),
      },
      errors: responses.filter((r) => r.error),
    };
  }

  /**
   * Get error metrics
   */
  public async getErrorMetrics({ range = 24, endDate = getUtcUnixTime(), params }: GetMetricsProps) {
    const prange = '15m';

    // get error percentage of requests in last [range] hours
    const percentage = this.client.query({
      query: `sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}, http_status_code=~"5.."}[${range}h])) / sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}}[${range}h])) * 100`,
    });
    const prevPercentage = this.client.query({
      query: `sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}, http_status_code=~"5.."}[${range}h])) / sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}}[${range}h] offset ${range}h)) * 100`,
    });

    // get top 5 operations in last [range] hours
    const top5 = this.client.query({
      query: `topk(5, sum by (wg_operation_name) (rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}, http_status_code!="5.."}[${range}h])) / sum by (wg_operation_name) (rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}}[${range}h])) * 100)`,
    });

    // get requests in last [range] hours in series of [step]
    const series = this.client.queryRange({
      query: `sum (rate(cosmo_router_http_requests_total{${this.getQueryLabels(params)}}[${prange}]))`,
      ...this.getRangeQueryProps({
        range,
        endDate,
      }),
    });

    const prevSeries = this.client.queryRange({
      query: `sum (rate(cosmo_router_http_requests_total{${this.getQueryLabels(params)}}[${prange}]))`,
      ...this.getRangeQueryProps({
        range,
        endDate: endDate - range * 60 * 60 * 1000,
      }),
    });

    const responses = await this.getResponses(percentage, prevPercentage, top5, series, prevSeries);
    const [valueResponse, prevValueResponse, top5Response, seriesResponse, prevSeriesResponse] = responses;

    return {
      data: {
        value: valueResponse.data?.result[0]?.value[1] || '0',
        previousValue: prevValueResponse.data?.result[0]?.value[1] || '0',
        top:
          top5Response.data?.result.map((v: any) => ({
            name: v.metric.wg_operation_name || 'unknown',
            value: v.value[1] || '0',
          })) || [],
        series: this.mapSeries(
          endDate,
          range,
          seriesResponse.data?.result[0].values,
          prevSeriesResponse.data?.result[0]?.values,
        ),
      },
      errors: responses.filter((r) => r.error),
    };
  }

  /**
   * Get error rate metrics
   */
  public async getErrorRateMetrics({
    range = 24,
    endDate = getUtcUnixTime(),
    params,
  }: {
    range?: number;
    endDate?: number;
    params: MetricsParams;
  }) {
    const prange = '5m';

    // get requests in last [range] hours in series of [step]
    const requestRate = this.client.queryRange({
      query: `sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(params)}}[${prange}]) * 60)`,
      ...this.getRangeQueryProps({
        range,
        endDate,
      }),
    });

    const errorRate = this.client.queryRange({
      query: `sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}, http_status_code=~"5.."}[${prange}]) * 60)`,
      ...this.getRangeQueryProps({
        range,
        endDate,
      }),
    });

    const responses = await this.getResponses(requestRate, errorRate);
    const [requestRateResponse, errorRateResponse] = responses;

    return {
      data: {
        series: this.mapSeries(endDate, range, requestRateResponse.data?.result[0].values),
        errorSeries: this.mapSeries(endDate, range, errorRateResponse.data?.result[0].values),
      },
      errors: responses.filter((r) => r.error),
    };
  }

  protected getQueryLabels = (params: MetricsParams) => {
    return `wg_organization_id="${params.organizationId}", wg_federated_graph_id="${params.graphId}"`;
  };

  /**
   * Get range query props
   * @param options {GetRangeQueryPropsOptions}
   * @returns
   */
  protected getRangeQueryProps = (options: GetRangeQueryPropsOptions) => {
    const { range, endDate = Date.now() } = options;

    return {
      start: this.getStart(endDate, range),
      end: String(endDate / 1000),
      step: getStep(range),
    };
  };

  /**
   * Subtracts the range in hours from the timestamp and returns the start timestamp
   * @param timestampInMs
   * @param rangeInHours
   * @returns
   */
  protected getStart = (timestampInMs: number, rangeInHours: number) => {
    return String(timestampInMs / 1000 - rangeInHours * 60 * 60);
  };

  /**
   * @todo This is efficient, but prometheus doesn't fill in missing values, so we create the series range
   * and then fill in the values from the prometheus response
   * @param endDate
   * @param range
   * @param series
   * @param previousSeries
   * @returns
   */
  protected mapSeries(endDate: number, range: number, series: any[] = [], previousSeries?: any[]) {
    const timeRange = createTimeRange(endDate, range);

    return timeRange.map((v) => {
      const timestamp = String(Math.round(Number.parseInt(v.timestamp) / 1000));
      const prevTimestamp = String(Math.round((Number.parseInt(v.timestamp) - range * 60 * 60 * 1000) / 1000));
      return {
        ...v,
        value: String(Number.parseFloat(series?.find((s) => String(s[0]) === timestamp)?.[1] || '0')),
        previousValue: String(
          Number.parseFloat(previousSeries?.find((s) => String(s[0]) === prevTimestamp)?.[1] || '0'),
        ),
      };
    });
  }
}
