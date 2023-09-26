import { PlainMessage } from '@bufbuild/protobuf';
import { OperationRequestCount, RequestSeriesItem } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import PrometheusClient from 'src/core/prometheus/client.js';
import { QueryResultValue } from 'src/core/prometheus/types.js';
import { createTimeRange, parseValue } from './util.js';

export class AnalyticsDashboardViewRepository {
  constructor(private client: PrometheusClient) {}

  private async getWeeklyRequestSeries(
    federatedGraphId: string,
    organizationId: string,
  ): Promise<PlainMessage<RequestSeriesItem>[]> {
    const endDate = Math.round(Date.now() / 1000) * 1000;

    const requests = this.client.queryRange({
      query: `sum(rate(cosmo_router_http_requests_total{wg_organization_id="${organizationId}", wg_federated_graph_id="${federatedGraphId}"}[4h]) * 60 * 60 * 4)`,
      start: String((endDate - 7 * 24 * 60 * 60 * 1000) / 1000),
      end: String(endDate / 1000),
      step: String(4 * 60 * 60),
    });

    const errors = this.client.queryRange({
      query: `sum(rate(cosmo_router_http_requests_total{wg_organization_id="${organizationId}", wg_federated_graph_id="${federatedGraphId}", http_status_code=~"4..|5.."}[4h]) * 60 * 60 * 4)`,
      start: String((endDate - 7 * 24 * 60 * 60 * 1000) / 1000),
      end: String(endDate / 1000),
      step: String(4 * 60 * 60),
    });

    const [requestsResponse, errorsResponse] = await Promise.all([requests, errors]);

    return this.mapSeries(endDate, 168, {
      totalRequests: requestsResponse.data.result,
      erroredRequests: errorsResponse.data.result,
    });
  }

  private async getWeeklyTotals(federatedGraphId: string, organizationId: string) {
    const total = this.client.query({
      query: `sum(increase(cosmo_router_http_requests_total{wg_organization_id="${organizationId}", wg_federated_graph_id="${federatedGraphId}"}[1w]))`,
    });

    const totalErrors = this.client.query({
      query: `sum(increase(cosmo_router_http_requests_total{wg_organization_id="${organizationId}", wg_federated_graph_id="${federatedGraphId}", http_status_code=~"4..|5.."}[1w]))`,
    });

    const [totalResponse, totalErrorsResponse] = await Promise.all([total, totalErrors]);

    return {
      requests: Number.parseInt(parseValue(totalResponse.data.result[0].value[1])),
      errors: Number.parseInt(parseValue(totalErrorsResponse.data.result[0].value[1])),
    };
  }

  private async getAllWeeklyRequestSeries(
    organizationId: string,
  ): Promise<Record<string, PlainMessage<RequestSeriesItem>[]>> {
    const endDate = Math.round(Date.now() / 1000) * 1000;

    const requests = this.client.queryRange({
      query: `sum by (wg_federated_graph_id) (rate(cosmo_router_http_requests_total{wg_organization_id="${organizationId}"}[4h]) * 60 * 60 * 4)`,
      start: String((endDate - 7 * 24 * 60 * 60 * 1000) / 1000),
      end: String(endDate / 1000),
      step: String(4 * 60 * 60),
    });

    const errors = this.client.queryRange({
      query: `sum by (wg_federated_graph_id) (rate(cosmo_router_http_requests_total{wg_organization_id="${organizationId}", http_status_code=~"4..|5.."}[4h]) * 60 * 60 * 4)`,
      start: String((endDate - 7 * 24 * 60 * 60 * 1000) / 1000),
      end: String(endDate / 1000),
      step: String(4 * 60 * 60),
    });

    const [requestsResponse, errorsResponse] = await Promise.all([requests, errors]);

    const series: Record<string, PlainMessage<RequestSeriesItem>[]> = {};

    for (const serie in requestsResponse.data.result) {
      const id = requestsResponse.data.result[serie].metric.wg_federated_graph_id;
      const errorRequests = errorsResponse.data.result?.find(({ metric }) => metric?.wg_federated_graph_id === id);
      series[id] = this.mapSeries(endDate, 168, {
        totalRequests: [requestsResponse.data.result[serie]],
        erroredRequests: errorRequests ? [errorRequests] : [],
      });
    }

    return series;
  }

  private async getWeeklyMostRequested(
    federatedGraphId: string,
    organizationId: string,
  ): Promise<PlainMessage<OperationRequestCount>[]> {
    const top5 = await this.client.query({
      query: `topk(5, sum by (wg_operation_name) (increase(cosmo_router_http_requests_total{wg_organization_id="${organizationId}", wg_federated_graph_id="${federatedGraphId}"}[1w])))`,
    });

    return top5.data.result.map((result) => {
      return {
        operationName: result.metric.wg_operation_name || 'unknown',
        totalRequests: Number.parseInt(parseValue(result.value[1])),
      };
    });
  }

  public async getListView(organizationId: string): Promise<Record<string, PlainMessage<RequestSeriesItem>[]>> {
    const requestSeriesList = await this.getAllWeeklyRequestSeries(organizationId);
    return requestSeriesList;
  }

  public async getView(federatedGraphId: string, organizationId: string) {
    const [totals, requestSeries, mostRequestedOperations] = await Promise.all([
      this.getWeeklyTotals(federatedGraphId, organizationId),
      this.getWeeklyRequestSeries(federatedGraphId, organizationId),
      this.getWeeklyMostRequested(federatedGraphId, organizationId),
    ]);

    return {
      totals,
      requestSeries,
      mostRequestedOperations,
    };
  }

  protected mapSeries<Series extends Record<string, QueryResultValue[]>>(
    endDate: number,
    range: number,
    series: Series,
  ): Series extends Record<infer Key, QueryResultValue[]>
    ? ({ timestamp: string } & {
        [key in Key]: number;
      })[]
    : [] {
    const timeRange = createTimeRange(endDate, range, 4 * 60);

    const s = Object.entries(series);

    return timeRange.map((v) => {
      const timestamp = String(Math.round(Number.parseInt(v.timestamp) / 1000));

      const metrics: Record<string, number> = {};

      for (const [key, results] of s) {
        const values = results[0].values;
        metrics[key] = Number.parseInt(values?.find((s) => String(s[0]) === timestamp)?.[1] || '0');
      }

      return {
        ...metrics,
        ...v,
      };
    }) as any;
  }
}
