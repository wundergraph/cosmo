import PrometheusClient from 'src/core/prometheus/client.js';

const getStep = (range: number) => {
  switch (range) {
    case 72: {
      // 3 days
      return '15m';
    }
    case 168: {
      // 7 days
      return '30m';
    }
    case 24: {
      // 1 day
      return '5m';
    }
  }

  return '5m';
};

interface MetricsParams {
  organizationId: string;
  graphId: string;
  graphName: string;
}

export class MetricsDashboardRepository {
  constructor(private client: PrometheusClient) {}

  /**
   * Get request reate metrics
   */
  public async getRequestRateMetrics({ range = 24, params }: { range?: number; params: MetricsParams }) {
    const prange = '5m';

    // get median of requests in last [range] hours
    const median = await this.client.query({
      query: `quantile(0.5, rate(cosmo_router_http_requests_total{wg_organization_id="${params.organizationId}", wg_federated_graph_id="${params.graphId}"}[${prange}]))`,
    });

    // get top 5 operations in last [range] hours
    const top5 = await this.client.query({
      query: `topk(5, sum by (wg_operation_name) (rate(cosmo_router_http_requests_total{wg_organization_id="${params.organizationId}", wg_federated_graph_id="${params.graphId}"}[${range}h])))`,
    });

    // get requests in last [range] hours in series of [step]
    const result = await this.client.queryRange({
      query: `rate(cosmo_router_http_requests_total{wg_organization_id="${params.organizationId}", wg_federated_graph_id="${params.graphId}"}[${prange}])`,
      start: String(Date.now() / 1000 - range * 60 * 60),
      end: String(Date.now() / 1000),
      step: getStep(range),
    });

    return {
      median: Number.parseInt(median.data.result[0]?.value[1]),
      top: top5.data.result.map((v: any) => ({
        name: v.metric.wg_operation_name,
        value: Number.parseInt(v.value[1]),
      })),
      series:
        result.data.result[0]?.values.map((v: any) => ({
          timestamp: String(v[0] * 1000),
          value: Number.parseInt(v[1]),
          previousValue: 0, // not implemented yet
        })) ?? [],
    };
  }

  /**
   * Get latency metrics
   */
  public async getLatencyMetrics({ range = 24, params }: { range?: number; params: MetricsParams }) {
    const prange = '5m';

    // get p95 of requests in last [range] hours
    const latencyP95 = await this.client.query({
      query: `histogram_quantile(0.95, sum(rate(cosmo_router_http_request_duration_milliseconds_bucket{wg_organization_id="${params.organizationId}", wg_federated_graph_id="${params.graphId}"}[${prange}])) by (le))`,
    });

    // get top 5 operations in last [range] hours
    const top5 = await this.client.query({
      query: `topk(5, sum by (wg_operation_name) (rate(cosmo_router_http_request_duration_milliseconds_bucket{wg_organization_id="${params.organizationId}", wg_federated_graph_id="${params.graphId}"}[${range}h])))`,
    });

    // get p95 latency [range] hours in series of [step]
    const result = await this.client.queryRange({
      query: `histogram_quantile(0.95, sum(rate(cosmo_router_http_request_duration_milliseconds_bucket{wg_organization_id="${params.organizationId}", wg_federated_graph_id="${params.graphId}"}[${prange}])) by (le))`,
      start: String(Date.now() / 1000 - range * 60 * 60),
      end: String(Date.now() / 1000),
      step: getStep(range),
    });

    return {
      p95: Number.parseInt(latencyP95.data.result[0]?.value[1]),
      top: top5.data.result.map((v: any) => ({
        name: v.metric.wg_operation_name,
        value: Number.parseInt(v.value[1]),
      })),
      series:
        result.data.result[0]?.values.map((v: any) => ({
          timestamp: String(v[0] * 1000),
          value: Number.parseInt(v[1]),
          previousValue: 0, // not implemented yet
        })) ?? [],
    };
  }

  /**
   * Get error metrics
   */
  public async getErrorMetrics({ range = 24, params }: { range?: number; params: MetricsParams }) {
    const prange = '5m';

    // get error percentage of requests in last [range] hours
    const percentage = await this.client.query({
      query: `histogram_quantile(0.95, sum(rate(cosmo_router_http_request_duration_milliseconds_bucket{wg_organization_id="${params.organizationId}", wg_federated_graph_id="${params.graphId}"}[${prange}])) by (le))`,
    });

    // get top 5 operations in last [range] hours
    const top5 = await this.client.query({
      query: `topk(5, sum by (wg_operation_name) (rate(cosmo_router_http_request_duration_milliseconds_bucket{wg_organization_id="${params.organizationId}", wg_federated_graph_id="${params.graphId}"}[${range}h])))`,
    });

    // get p95 latency [range] hours in series of [step]
    const result = await this.client.queryRange({
      query: `histogram_quantile(0.95, sum(rate(cosmo_router_http_request_duration_milliseconds_bucket{wg_organization_id="${params.organizationId}", wg_federated_graph_id="${params.graphId}"}[${prange}])) by (le))`,
      start: String(Date.now() / 1000 - range * 60 * 60),
      end: String(Date.now() / 1000),
      step: getStep(range),
    });

    return {
      percentage: Number.parseInt(percentage.data.result[0]?.value[1]),
      top: top5.data.result.map((v: any) => ({
        name: v.metric.wg_operation_name,
        value: Number.parseInt(v.value[1]),
      })),
      series:
        result.data.result[0]?.values.map((v: any) => ({
          timestamp: String(v[0] * 1000),
          value: Number.parseInt(v[1]),
          previousValue: 0, // not implemented yet
        })) ?? [],
    };
  }
}
