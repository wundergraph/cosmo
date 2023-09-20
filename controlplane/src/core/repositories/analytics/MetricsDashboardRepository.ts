import PrometheusClient from 'src/core/prometheus/client.js';

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

  /**
   * Get request rate metrics
   */
  public async getRequestRateMetrics({ range = 24, endDate = getUtcUnixTime(), params }: GetMetricsProps) {
    const prange = '15m';

    // get median of requests in last [range] hours
    const median = await this.client.query({
      query: `quantile(0.5, sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}}[${range}h])) * 60)`,
    });

    const prevMedian = await this.client.query({
      query: `quantile(0.5, sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}}[${range}h] offset ${range}h)) * 60)`,
    });

    // get top 5 operations in last [range] hours
    const top5 = await this.client.query({
      query: `topk(5, sum by (wg_operation_name) (rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}}[${range}h])) * 60)`,
    });

    // get requests in last [range] hours in series of [step]
    const result = await this.client.queryRange({
      query: `sum (rate(cosmo_router_http_requests_total{${this.getQueryLabels(params)}}[${prange}]) * 60)`,
      ...this.getRangeQueryProps({
        range,
        endDate,
      }),
    });

    const prevResult = await this.client.queryRange({
      query: `sum (rate(cosmo_router_http_requests_total{${this.getQueryLabels(params)}}[${prange}]) * 60)`,
      ...this.getRangeQueryProps({
        range,
        endDate: endDate - range * 60 * 60 * 1000,
      }),
    });

    return {
      value: median.data.result[0]?.value[1],
      previousValue: prevMedian.data.result[0]?.value[1],
      top: top5.data.result.map((v: any) => ({
        name: v.metric.wg_operation_name,
        value: v.value[1],
      })),
      series: this.mapSeries(endDate, range, result.data.result[0].values, prevResult.data.result[0]?.values),
    };
  }

  /**
   * Get latency metrics
   */
  public async getLatencyMetrics({ range = 24, endDate = getUtcUnixTime(), params }: GetMetricsProps) {
    const prange = '15m';

    // get p95 of requests in last [range] hours
    const latencyP95 = await this.client.query({
      query: `histogram_quantile(0.95, sum(rate(cosmo_router_http_request_duration_milliseconds_bucket{${this.getQueryLabels(
        params,
      )}}[${range}h])) by (le))`,
    });

    const prevLatencyP95 = await this.client.query({
      query: `histogram_quantile(0.95, sum(rate(cosmo_router_http_request_duration_milliseconds_bucket{${this.getQueryLabels(
        params,
      )}}[${range}h] offset ${range}h)) by (le))`,
    });

    // get top 5 operations in last [range] hours
    const top5 = await this.client.query({
      query: `topk(5, sum by (wg_operation_name) (rate(cosmo_router_http_request_duration_milliseconds_bucket{${this.getQueryLabels(
        params,
      )}}[${range}h])))`,
    });

    // get p95 latency [range] hours in series of [step]
    const result = await this.client.queryRange({
      query: `histogram_quantile(0.95, sum(rate(cosmo_router_http_request_duration_milliseconds_bucket{${this.getQueryLabels(
        params,
      )}}[${prange}])) by (le))`,
      ...this.getRangeQueryProps({
        range,
        endDate,
      }),
    });

    const prevResult = await this.client.queryRange({
      query: `histogram_quantile(0.95, sum(rate(cosmo_router_http_request_duration_milliseconds_bucket{${this.getQueryLabels(
        params,
      )}}[${prange}] offset ${range}h)) by (le))`,
      ...this.getRangeQueryProps({
        range,
        endDate: endDate - range * 60 * 60 * 1000,
      }),
    });

    return {
      value: latencyP95.data.result[0]?.value[1],
      previousValue: prevLatencyP95.data.result[0]?.value[1],
      top: top5.data.result.map((v: any) => ({
        name: v.metric.wg_operation_name,
        value: v.value[1],
      })),
      series: this.mapSeries(endDate, range, result.data.result[0].values, prevResult.data.result[0]?.values),
    };
  }

  /**
   * Get error metrics
   */
  public async getErrorMetrics({ range = 24, endDate = getUtcUnixTime(), params }: GetMetricsProps) {
    const prange = '15m';

    // get error percentage of requests in last [range] hours
    const percentage = await this.client.query({
      query: `sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}, http_status_code!~"2.."}[${range}h])) / sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}}[${range}h])) * 100`,
    });
    const previousPercentage = await this.client.query({
      query: `sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}, http_status_code!~"2.."}[${range}h])) / sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}}[${range}h] offset ${range}h)) * 100`,
    });

    // get top 5 operations in last [range] hours
    const top5 = await this.client.query({
      query: `topk(5, sum by (wg_operation_name) (rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}, http_status_code!~"2.."}[${range}h])) / sum by (wg_operation_name) (rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}}[${range}h])) * 100)`,
    });

    // get requests in last [range] hours in series of [step]
    const result = await this.client.queryRange({
      query: `sum (rate(cosmo_router_http_requests_total{${this.getQueryLabels(params)}}[${prange}]))`,
      ...this.getRangeQueryProps({
        range,
        endDate,
      }),
    });

    const prevResult = await this.client.queryRange({
      query: `sum (rate(cosmo_router_http_requests_total{${this.getQueryLabels(params)}}[${prange}]))`,
      ...this.getRangeQueryProps({
        range,
        endDate: endDate - range * 60 * 60 * 1000,
      }),
    });

    return {
      value: percentage.data.result[0]?.value[1],
      previousValue: previousPercentage.data.result[0]?.value[1],
      top: top5.data.result.map((v: any) => ({
        name: v.metric.wg_operation_name,
        value: v.value[1],
      })),
      series: this.mapSeries(endDate, range, result.data.result[0].values, prevResult.data.result[0]?.values),
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
    const result = await this.client.queryRange({
      query: `sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(params)}}[${prange}]) * 60)`,
      ...this.getRangeQueryProps({
        range,
        endDate,
      }),
    });

    const errorRate = await this.client.queryRange({
      query: `sum(rate(cosmo_router_http_requests_total{${this.getQueryLabels(
        params,
      )}, http_status_code!~"2.."}[${prange}]) * 60)`,
      ...this.getRangeQueryProps({
        range,
        endDate,
      }),
    });

    return {
      series: this.mapSeries(endDate, range, result.data.result[0].values),
      errorSeries: this.mapSeries(endDate, range, errorRate.data.result[0].values),
    };
  }

  protected getQueryLabels = (params: MetricsParams) => {
    return `wg_organization_id="${params.organizationId}", wg_federated_graph_id="${params.graphId}", wg_router_graph_name="${params.graphName}"`;
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
