import { PlainMessage } from '@bufbuild/protobuf';
import {
  ClientWithOperations,
  FieldUsageMeta,
  RequestSeriesItem,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../clickhouse/index.js';
import { getDateRange, getEndDate, getGranularity } from './util.js';

type ParsedFilters = {
  granule: string;
  range: number;
  dateRange: {
    start: number;
    end: number;
  };
  organizationId: string;
  federatedGraphId: string;
  latestRouterConfigVersion: string;
};

export class UsageRepository {
  constructor(private client: ClickHouseClient) {}

  private parseFilters(filters: {
    range: number;
    organizationId: string;
    federatedGraphId: string;
    latestRouterConfigVersion: string;
  }): ParsedFilters {
    const { range, organizationId, federatedGraphId, latestRouterConfigVersion } = filters;
    const granule = getGranularity(range);
    const [start, end] = getDateRange(getEndDate(), range);

    return {
      granule,
      range,
      dateRange: {
        start,
        end,
      },
      organizationId,
      federatedGraphId,
      latestRouterConfigVersion,
    };
  }

  private async getUsageRequestSeries(
    typename: string,
    field: string,
    filters: ParsedFilters,
  ): Promise<PlainMessage<RequestSeriesItem>[]> {
    const {
      federatedGraphId,
      organizationId,
      latestRouterConfigVersion,
      dateRange: { start, end },
      granule,
    } = filters;

    const query = `
    WITH
        toStartOfInterval(toDateTime('${start}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${end}') AS endDate
    SELECT
        toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
        sum(Count) as totalRequests
    FROM ${this.client.database}.gql_metrics_schema_usage
    WHERE timestamp >= startDate AND timestamp <= endDate
        AND hasAny(TypeNames, ['${typename}'])
        AND endsWith(Path, ['${field}'])
        AND FederatedGraphID = '${federatedGraphId}'
        AND OrganizationID = '${organizationId}'
        AND RouterConfigVersion = '${latestRouterConfigVersion}'
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
        erroredRequests: 0,
      }));
    }

    return [];
  }

  private async getClientsWithOperations(
    typename: string,
    field: string,
    filters: ParsedFilters,
  ): Promise<PlainMessage<ClientWithOperations>[]> {
    const {
      federatedGraphId,
      organizationId,
      latestRouterConfigVersion,
      dateRange: { start, end },
    } = filters;

    const query = `
    WITH
      toDateTime('${start}') AS startDate,
      toDateTime('${end}') AS endDate
    SELECT
      clientName,
      clientVersion,
      groupArray((latestOperationHash, operationName, requestCount)) AS operations
      FROM (
          SELECT
              ClientName as clientName,
              ClientVersion as clientVersion,
              OperationName as operationName,
              argMax(OperationHash, Timestamp) as latestOperationHash,
              sum(Count) as requestCount
          FROM ${this.client.database}.gql_metrics_schema_usage
          WHERE Timestamp >= startDate AND Timestamp <= endDate
              AND hasAny(TypeNames, ['${typename}'])
              AND endsWith(Path, ['${field}'])
              AND FederatedGraphID = '${federatedGraphId}'
              AND OrganizationID = '${organizationId}'
              AND RouterConfigVersion = '${latestRouterConfigVersion}'
          GROUP BY clientName, clientVersion, operationName
      )
    GROUP BY clientName, clientVersion
    ORDER BY clientName, clientVersion
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

  private async getMeta(
    typename: string,
    field: string,
    filters: ParsedFilters,
  ): Promise<PlainMessage<FieldUsageMeta> | undefined> {
    const {
      federatedGraphId,
      organizationId,
      latestRouterConfigVersion,
      dateRange: { start, end },
    } = filters;

    const query = `
    WITH
      toDateTime('${start}') AS startDate,
      toDateTime('${end}') AS endDate
    SELECT
      arrayReduce('groupUniqArray', arrayFlatten(groupArray(SubgraphIDs))) as subgraphIds,
      toString(toUnixTimestamp(min(Timestamp))) as firstSeenTimestamp,
      toString(toUnixTimestamp(max(Timestamp))) as latestSeenTimestamp
    FROM gql_metrics_schema_usage
      WHERE Timestamp >= startDate AND Timestamp <= endDate
      AND hasAny(TypeNames, ['${typename}'])
      AND endsWith(Path, ['${field}'])
      AND FederatedGraphID = '${federatedGraphId}'
      AND OrganizationID = '${organizationId}'
      AND RouterConfigVersion = '${latestRouterConfigVersion}'
    `;

    const res = await this.client.queryPromise(query);

    if (Array.isArray(res) && res[0]) {
      return res[0];
    }
  }

  public async getFieldUsage(input: {
    typename: string;
    field: string;
    range: number;
    organizationId: string;
    federatedGraphId: string;
    latestRouterConfigVersion: string;
  }) {
    const filters = this.parseFilters(input);

    const [requestSeries, clients, meta] = await Promise.all([
      this.getUsageRequestSeries(input.typename, input.field, filters),
      this.getClientsWithOperations(input.typename, input.field, filters),
      this.getMeta(input.typename, input.field, filters),
    ]);

    return {
      requestSeries,
      clients,
      meta,
    };
  }
}
