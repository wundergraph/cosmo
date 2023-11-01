import { PlainMessage } from '@bufbuild/protobuf';
import {
  ClientWithOperations,
  FieldUsageMeta,
  RequestSeriesItem,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../clickhouse/index.js';
import { getDateRange, getEndDate, getGranularity } from './util.js';

type TimeFilters = {
  granule: string;
  range: number;
  dateRange: {
    start: number;
    end: number;
  };
};

export class UsageRepository {
  constructor(private client: ClickHouseClient) {}

  private parseRange(range: number): TimeFilters {
    const granule = getGranularity(range);
    const [start, end] = getDateRange(getEndDate(), range);

    return {
      granule,
      range,
      dateRange: {
        start,
        end,
      },
    };
  }

  private async getUsageRequestSeries(
    whereSql: string,
    timeFilters: TimeFilters,
  ): Promise<PlainMessage<RequestSeriesItem>[]> {
    const {
      dateRange: { start, end },
      granule,
    } = timeFilters;

    const query = `
      WITH 
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          SUM(TotalUsages) AS totalRequests,
          SUM(TotalErrors) AS erroredRequests
      FROM ${this.client.database}.gql_metrics_schema_usage_5m_90d_mv
      WHERE Timestamp >= startDate AND Timestamp <= endDate AND ${whereSql}
      GROUP BY timestamp
      ORDER BY timestamp WITH FILL 
      FROM toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE)
      TO toDateTime('${end}')
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
      dateRange: { start, end },
    } = timeFilters;

    const query = `
      WITH
        toDateTime('${start}') AS startDate,
        toDateTime('${end}') AS endDate
      SELECT
        ClientName AS clientName,
        ClientVersion AS clientVersion,
        groupArray((latestOperationHash, OperationName, requestCount)) AS operations
      FROM 
        (
            SELECT
                ClientName,
                ClientVersion,
                OperationName,
                argMax(OperationHash, Timestamp) AS latestOperationHash,
                sum(TotalUsages) AS requestCount
            FROM ${this.client.database}.gql_metrics_schema_usage_5m_90d_mv
            WHERE Timestamp >= startDate AND Timestamp <= endDate AND ${whereSql}
            GROUP BY ClientName, ClientVersion, OperationName
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
          latestHash: op[0],
          name: op[1],
          count: Number(op[2]),
        })),
      }));
    }

    return [];
  }

  private async getMeta(whereSql: string, timeFilters: TimeFilters): Promise<PlainMessage<FieldUsageMeta> | undefined> {
    const {
      dateRange: { start, end },
    } = timeFilters;

    const query = `
    WITH
      toDateTime('${start}') AS startDate,
      toDateTime('${end}') AS endDate
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
    range: number;
    organizationId: string;
    federatedGraphId: string;
  }) {
    const timeFilters = this.parseRange(input.range);

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
