import { PlainMessage } from '@bufbuild/protobuf';
import { OperationRequestCount, RequestSeriesItem } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import PrometheusClient from 'src/core/prometheus/client.js';
import { padMissingDates } from './util.js';

export class AnalyticsDashboardViewRepository2 {
  constructor(private client: PrometheusClient) {}

  private async getWeeklyRequestSeries(
    federatedGraphId: string,
    organizationId: string,
  ): Promise<PlainMessage<RequestSeriesItem>[]> {
    const response = await this.client.queryRange({
      query: `sum by (status_code) (rate(cosmo_router_http_requests_total{wg_organization_id="${organizationId}", wg_federated_graph_id="${federatedGraphId}"}[1m]) * 60)`,
      start: String((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000),
      end: String(Date.now() / 1000),
      step: String(60 * 60 * 4),
    });
    console.log('SERIES', JSON.stringify(response.data.result, null, 2));
    const series =
      response.data.result
        ?.map((s) => {
          const data = s.values.map((v) => ({
            timestamp: String(v[0]),
            totalRequests: Number(v[1]),
            erroredRequests: 0,
          }));

          return data;
        })
        .flat() || [];

    // if (Array.isArray(seriesRes)) {
    //   const padded = padMissingDates(seriesRes);
    //   return padded.map((p) => ({
    //     ...p,
    //     totalRequests: Number(p.totalRequests),
    //     erroredRequests: Number(p.erroredRequests),
    //   }));
    // }

    return padMissingDates(series);
  }

  private async getAllWeeklyRequestSeries(
    organizationId: string,
  ): Promise<Record<string, PlainMessage<RequestSeriesItem>[]>> {
    // const query = `
    //     SELECT
    //         toDate(Timestamp) as timestamp,
    //         COUNT(*) as totalRequests,
    //         SUM(if(StatusCode = 'STATUS_CODE_ERROR' OR position(SpanAttributes['http.status_code'],'4') = 1, 1, 0)) as erroredRequests,
    //         SpanAttributes['wg.federated_graph.id'] as graphId
    //     FROM
    //         ${this.client.database}.otel_traces
    //     WHERE
    //     -- Only root spans(spans which have no parent span) and has no condition on SpanKind as a span can start from either the server or the client
    //         empty(ParentSpanId)
    //         AND SpanAttributes['wg.organization.id'] = '${organizationId}'
    //     AND toDate(Timestamp) >= toDate(now()) - interval 6 day
    //     GROUP BY
    //         timestamp,
    //         SpanAttributes['wg.federated_graph.id']
    //     ORDER BY
    //         timestamp DESC
    // `;

    // const seriesResWithGraphId = await this.client.queryPromise(query);

    // if (Array.isArray(seriesResWithGraphId)) {
    //   const transformed: Record<string, PlainMessage<RequestSeriesItem>[]> = {};

    //   for (const item of seriesResWithGraphId) {
    //     const { graphId, ...rest } = item;

    //     if (!transformed[graphId]) {
    //       transformed[graphId] = [];
    //     }

    //     transformed[graphId].push(rest);
    //   }

    //   for (const key in transformed) {
    //     const padded = padMissingDates(transformed[key]);
    //     transformed[key] = padded;
    //     for (const item of padded) {
    //       item.totalRequests = Number(item.totalRequests);
    //       item.erroredRequests = Number(item.erroredRequests);
    //     }
    //   }

    //   return transformed;
    // }

    return await {};
  }

  private async getWeeklyMostRequested(
    federatedGraphId: string,
    organizationId: string,
  ): Promise<PlainMessage<OperationRequestCount>[]> {
    // const query = `
    //     SELECT
    //         COALESCE(NULLIF(SpanAttributes['wg.operation.name'], ''), 'unknown') as operationName,
    //         COUNT(*) as totalRequests
    //     FROM
    //         ${this.client.database}.otel_traces
    //     WHERE
    //     -- Only root spans(spans which have no parent span) and has no condition on SpanKind as a span can start from either the server or the client
    //         empty(ParentSpanId)
    //         AND toDate(Timestamp) >= toDate(now()) - interval 6 day
    //         AND SpanAttributes['wg.federated_graph.id'] = '${federatedGraphId}'
    //         AND SpanAttributes['wg.organization.id'] = '${organizationId}'
    //     GROUP BY
    //         operationName
    //     ORDER BY
    //         totalRequests DESC
    //     LIMIT 5
    // `;

    // const res = await this.client.queryPromise(query);

    // if (Array.isArray(res)) {
    //   return res.map((r) => ({
    //     ...r,
    //     totalRequests: Number(r.totalRequests),
    //   }));
    // }

    return await [];
  }

  public async getListView(organizationId: string): Promise<Record<string, PlainMessage<RequestSeriesItem>[]>> {
    const requestSeriesList = await this.getAllWeeklyRequestSeries(organizationId);
    return requestSeriesList;
  }

  public async getView(federatedGraphId: string, organizationId: string) {
    const [requestSeries, mostRequestedOperations] = await Promise.all([
      this.getWeeklyRequestSeries(federatedGraphId, organizationId),
      this.getWeeklyMostRequested(federatedGraphId, organizationId),
    ]);

    return {
      requestSeries,
      mostRequestedOperations,
    };
  }
}
