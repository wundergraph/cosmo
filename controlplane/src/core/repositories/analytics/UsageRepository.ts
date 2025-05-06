import { PlainMessage } from '@bufbuild/protobuf';
import {
  ClientWithOperations,
  FieldUsageMeta,
  RequestSeriesItem,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../clickhouse/index.js';
import { DateRange, Field, TimeFilters } from '../../../types/index.js';
import { flipDateRangeValuesIfNeeded } from '../../util.js';
import { parseTimeFilters } from './util.js';

export class UsageRepository {
  constructor(private client: ClickHouseClient) {}

  private async getUsageRequestSeries(
    whereSql: string,
    timeFilters: TimeFilters,
  ): Promise<PlainMessage<RequestSeriesItem>[]> {
    const { dateRange, granule } = timeFilters;
    flipDateRangeValuesIfNeeded(dateRange);

    const query = `
      WITH 
        toStartOfInterval(toDateTime('${dateRange.start}'), INTERVAL ${granule} MINUTE) AS startDate,
        toDateTime('${dateRange.end}') AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL ${granule} MINUTE) AS timestamp,
          SUM(TotalUsages) AS totalRequests,
          SUM(TotalErrors) AS erroredRequests
      FROM ${this.client.database}.gql_metrics_schema_usage_5m_90d
      WHERE Timestamp >= startDate AND Timestamp <= endDate AND ${whereSql}
      GROUP BY timestamp
      ORDER BY timestamp WITH FILL 
      FROM toStartOfInterval(toDateTime('${dateRange.start}'), INTERVAL ${granule} MINUTE)
      TO toDateTime('${dateRange.end}')
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
        groupArray((OperationHash, OperationName, requestCount)) AS operations
      FROM 
        (
            SELECT
                ClientName,
                ClientVersion,
                OperationName,
                OperationHash,
                sum(TotalUsages) AS requestCount
            FROM ${this.client.database}.gql_metrics_schema_usage_5m_90d
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
    FROM ${this.client.database}.gql_metrics_schema_usage_5m_90d
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
    whereSql += ` AND IsIndirectFieldUsage = false`;

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

  public async getUnusedFields({
    organizationId,
    federatedGraphId,
    rangeInHours,
    fields,
  }: {
    organizationId: string;
    federatedGraphId: string;
    rangeInHours: number;
    fields: Field[];
  }): Promise<{ name: string; typeName: string }[]> {
    const arrayJoinFields = fields.map((field) => `('${field.name}', '${field.typeName}')`).join(', ');
    const {
      dateRange: { end, start },
    } = parseTimeFilters(undefined, rangeInHours);
    // all_fields is a table of all fields and its typenames that we want to check if they are unused.
    // used_fields is table which contains the fields that are used in the given time range.
    // We then left join all_fields with used_fields and select the fields that do not have an entry in used_fields.
    // which will give us the fields that are not used.

    // In the used_fields query, we use ARRAY JOIN to expand the TypeNames array into separate rows.

    const query = `
      WITH 
        toStartOfDay(toDateTime('${start}')) AS startDate,
        toDateTime('${end}') AS endDate,
        all_fields AS (
          SELECT
              field.1 as Name,
              field.2 as TypeName
          FROM
          (
            SELECT
                arrayJoin([ ${arrayJoinFields} ]) as field
          )
        ),
        used_fields AS (
            SELECT
                DISTINCT on (FieldName, TypeName) FieldName,
                TypeName
            from
                gql_metrics_schema_usage_lite_1d_90d 
                ARRAY JOIN TypeNames AS TypeName
            where
                Timestamp >= startDate AND Timestamp <= endDate
                AND OrganizationID = '${organizationId}'
                AND FederatedGraphID = '${federatedGraphId}'
            GROUP BY
                FieldName, TypeName
        )
      SELECT
          all_fields.Name as name,
          all_fields.TypeName as typeName
      from
          all_fields
          LEFT JOIN used_fields ON all_fields.Name = used_fields.FieldName
          AND all_fields.TypeName = used_fields.TypeName
      WHERE
          used_fields.FieldName = ''
          AND used_fields.TypeName = ''
    `;

    const res = await this.client.queryPromise(query);

    if (Array.isArray(res)) {
      return res.map((item) => ({
        name: item.name,
        typeName: item.typeName,
      }));
    }

    return [];
  }

  public async getUsedFields({
    organizationId,
    federatedGraphId,
    range,
    fields,
  }: {
    organizationId: string;
    federatedGraphId: string;
    range: number;
    fields: Field[];
  }): Promise<{ name: string; typeName: string }[]> {
    const arrayJoinFields = fields.map((field) => `('${field.name}', '${field.typeName}')`).join(', ');
    const {
      dateRange: { end, start },
    } = parseTimeFilters(undefined, range);

    // all_fields is a table of all fields and their typenames that we want to check if they are used.
    // used_fields is table which contains the fields and their typenames that are used in the given time range.
    // We then inner join all_fields with used_fields and select all the entries.
    // which will give us the fields that are used.

    // In the used_fields query, we use ARRAY JOIN to expand the TypeNames array into separate rows.
    const query = `
      WITH 
        toStartOfDay(toDateTime('${start}')) AS startDate,
        toDateTime('${end}') AS endDate,
        all_fields AS (
          SELECT
              field.1 as Name,
              field.2 as TypeName
          FROM
          (
            SELECT
                arrayJoin([ ${arrayJoinFields} ]) as field
          )
        ),
        used_fields AS (
            SELECT
                DISTINCT on (FieldName, TypeName) FieldName,
                TypeName
            from
                gql_metrics_schema_usage_lite_1d_90d 
                ARRAY JOIN TypeNames AS TypeName
            where
                Timestamp >= startDate AND Timestamp <= endDate
                AND OrganizationID = '${organizationId}'
                AND FederatedGraphID = '${federatedGraphId}'
            GROUP BY
                FieldName, TypeName
        )
      SELECT
          all_fields.Name as name,
          all_fields.TypeName as typeName
      from
          all_fields
          INNER JOIN used_fields ON all_fields.Name = used_fields.FieldName
          AND all_fields.TypeName = used_fields.TypeName
    `;

    const res = await this.client.queryPromise(query);

    if (Array.isArray(res)) {
      return res.map((item) => ({
        name: item.name,
        typeName: item.typeName,
      }));
    }

    return [];
  }
}
