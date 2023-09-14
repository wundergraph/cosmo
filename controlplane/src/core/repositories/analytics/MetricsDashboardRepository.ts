import PrometheusClient from 'src/core/prometheus/client.js';

interface MetricsParams {
  organizationId: string;
  graphId: string;
  graphName: string;
}

export class MetricsDashboardRepository {
  constructor(private client: PrometheusClient) {}

  public async getRequestRateMetrics({ range = 24, params }: { range?: number; params: MetricsParams }) {
    const prange = '5m';

    const result = await this.client.queryRange({
      query: `rate(cosmo_router_http_requests{
            wg_organization_id="${params.organizationId}",
            wg_federated_graph_id="${params.graphId}",
            wg_router_graph_name=${params.graphName},
        }[${prange}])`,
      start: String(Date.now() / 1000 - range * 60 * 60),
      end: String(Date.now() / 1000),
      step: '1m',
    });

    return result;
  }
}
