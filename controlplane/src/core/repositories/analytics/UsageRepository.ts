import { PlainMessage } from '@bufbuild/protobuf';
import {
  ClientWithOperations,
  FieldUsageMeta,
  RequestSeriesItem,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../clickhouse/index.js';
import { DateRange, TimeFilters } from '../../../types/index.js';
import { parseTimeFilters } from './util.js';

export class UsageRepository {
  constructor(private client: ClickHouseClient) {}

  private async getUsageRequestSeries(
    whereSql: string,
    timeFilters: TimeFilters,
  ): Promise<PlainMessage<RequestSeriesItem>[]> {
    const {
      dateRange: { startDate, endDate },
      granule,
    } = timeFilters;

    const query = `
      WITH 
        toStartOfInterval(toDateTime('${startDate}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${endDate}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          SUM(TotalUsages) AS totalRequests,
          SUM(TotalErrors) AS erroredRequests
      FROM ${this.client.database}.gql_metrics_schema_usage_5m_90d_mv
      WHERE Timestamp >= startDate AND Timestamp <= endDate AND ${whereSql}
      GROUP BY timestamp
      ORDER BY timestamp WITH FILL 
      FROM toStartOfInterval(toDateTime('${startDate}'), INTERVAL ${granule} MINUTE)
      TO toDateTime('${endDate}')
      STEP INTERVAL ${granule} minute
    `;

    const res = await this.client.queryPromise(query);

    if (Array.isArray(res)) {
      return res.map((p) => ({
        timestamp: new Date(p.timestamp + 'Z').getTime().toString(),
        totalRequests: Number(p.totalRequests),
        erroredRequests: Number(p.erroredRequests),
      }));
    }

    return [];
  }

  private async getClientsWithOperations(
    whereSql: string,
    timeFilters: TimeFilters,
  ): Promise<PlainMessage<ClientWithOperations>[]> {
    const {
      dateRange: { startDate, endDate },
    } = timeFilters;

    const query = `
      WITH
        toDateTime('${startDate}') AS startDate,
        toDateTime('${endDate}') AS endDate
      SELECT
        ClientName AS clientName,
        ClientVersion AS clientVersion,
        groupArray((OperationHash, OperationName, requestCount)) AS operations
      FROM 
        (
            SELECT
                ClientName,
                ClientVersion,
                OperationName,
                OperationHash,
                sum(TotalUsages) AS requestCount
            FROM ${this.client.database}.gql_metrics_schema_usage_5m_90d_mv
            WHERE Timestamp >= startDate AND Timestamp <= endDate AND ${whereSql}
            GROUP BY ClientName, ClientVersion, OperationHash, OperationName
        )
      GROUP BY ClientName, ClientVersion
      ORDER BY ClientName, ClientVersion
    `;

    const res = await this.client.queryPromise(query);

    if (Array.isArray(res)) {
      return res.map((item) => ({
        name: item.clientName,
        version: item.clientVersion,
        operations: item.operations.map((op: any) => ({
          hash: op[0],
          name: op[1],
          count: Number(op[2]),
        })),
      }));
    }

    return [];
  }

  private async getMeta(whereSql: string, timeFilters: TimeFilters): Promise<PlainMessage<FieldUsageMeta> | undefined> {
    const {
      dateRange: { startDate, endDate },
    } = timeFilters;

    const query = `
    WITH
      toDateTime('${startDate}') AS startDate,
      toDateTime('${endDate}') AS endDate
    SELECT
      arrayReduce('groupUniqArray', arrayFlatten(groupArray(SubgraphIDs))) as subgraphIds,
      toString(toUnixTimestamp(min(Timestamp))) as firstSeenTimestamp,
      toString(toUnixTimestamp(max(Timestamp))) as latestSeenTimestamp
    FROM ${this.client.database}.gql_metrics_schema_usage_5m_90d_mv
    WHERE Timestamp >= startDate AND Timestamp <= endDate AND ${whereSql}
    `;

    const res = await this.client.queryPromise(query);

    if (Array.isArray(res) && res[0]) {
      return res[0];
    }
  }

  public async getFieldUsage(input: {
    typename?: string;
    field?: string;
    namedType?: string;
    range?: number;
    dateRange?: DateRange;
    organizationId: string;
    federatedGraphId: string;
  }) {
    const timeFilters = parseTimeFilters(input.dateRange, input.range);

    let whereSql = `FederatedGraphID = '${input.federatedGraphId}' AND OrganizationID = '${input.organizationId}'`;
    if (input.typename) {
      whereSql += ` AND hasAny(TypeNames, ['${input.typename}'])`;
    }
    if (input.field) {
      whereSql += ` AND FieldName = '${input.field}'`;
    }
    if (input.namedType) {
      whereSql += ` AND NamedType = '${input.namedType}'`;
    }

    const [requestSeries, clients, meta] = await Promise.all([
      this.getUsageRequestSeries(whereSql, timeFilters),
      this.getClientsWithOperations(whereSql, timeFilters),
      this.getMeta(whereSql, timeFilters),
    ]);

    return {
      requestSeries,
      clients,
      meta,
    };
  }
}
