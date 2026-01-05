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
    params: Record<string, string | number | boolean>,
  ): Promise<PlainMessage<RequestSeriesItem>[]> {
    const { dateRange, granule } = timeFilters;
    flipDateRangeValuesIfNeeded(dateRange);

    const query = `
      WITH 
        toStartOfInterval(toDateTime({startDate:UInt32}), INTERVAL {granule:UInt32} MINUTE) AS startDate,
        toDateTime({endDate:UInt32}) AS endDate
      SELECT
          toStartOfInterval(Timestamp, INTERVAL {granule:UInt32} MINUTE) AS timestamp,
          SUM(TotalUsages) AS totalRequests,
          SUM(TotalErrors) AS erroredRequests
      FROM ${this.client.database}.gql_metrics_schema_usage_5m_90d
      WHERE Timestamp >= startDate AND Timestamp <= endDate AND ${whereSql}
      GROUP BY timestamp
      ORDER BY timestamp WITH FILL 
      FROM toStartOfInterval(toDateTime({startDate:UInt32}), INTERVAL {granule:UInt32} MINUTE)
      TO toDateTime({endDate:UInt32})
      STEP INTERVAL {granule:UInt32} minute
    `;

    const queryParams = {
      ...params,
      startDate: dateRange.start,
      endDate: dateRange.end,
      granule,
    };

    const res = await this.client.queryPromise(query, queryParams);

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
    params: Record<string, string | number | boolean>,
  ): Promise<PlainMessage<ClientWithOperations>[]> {
    const {
      dateRange: { start, end },
    } = timeFilters;

    const query = `
      WITH
        toDateTime({startDate:UInt32}) AS startDate,
        toDateTime({endDate:UInt32}) AS endDate
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

    const queryParams = {
      ...params,
      startDate: start,
      endDate: end,
    };

    const res = await this.client.queryPromise(query, queryParams);

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

  private async getMeta(
    whereSql: string,
    timeFilters: TimeFilters,
    params: Record<string, string | number | boolean>,
  ): Promise<PlainMessage<FieldUsageMeta> | undefined> {
    const {
      dateRange: { start, end },
    } = timeFilters;

    const query = `
    WITH
      toDateTime({startDate:String}) AS startDate,
      toDateTime({endDate:String}) AS endDate
    SELECT
      arrayReduce('groupUniqArray', arrayFlatten(groupArray(SubgraphIDs))) as subgraphIds,
      toString(toUnixTimestamp(min(Timestamp))) as firstSeenTimestamp,
      toString(toUnixTimestamp(max(Timestamp))) as latestSeenTimestamp
    FROM ${this.client.database}.gql_metrics_schema_usage_5m_90d
    WHERE Timestamp >= startDate AND Timestamp <= endDate AND ${whereSql}
    `;

    const queryParams = {
      ...params,
      startDate: start,
      endDate: end,
    };

    const res = await this.client.queryPromise(query, queryParams);

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

    const params: Record<string, string | number | boolean> = {
      federatedGraphId: input.federatedGraphId,
      organizationId: input.organizationId,
    };

    let whereSql = `FederatedGraphID = {federatedGraphId:String} AND OrganizationID = {organizationId:String}`;

    if (input.typename) {
      params.typename = input.typename;
      whereSql += ` AND hasAny(TypeNames, [{typename:String}])`;
    }
    if (input.field) {
      params.field = input.field;
      whereSql += ` AND FieldName = {field:String}`;
    }
    if (input.namedType) {
      params.namedType = input.namedType;
      whereSql += ` AND NamedType = {namedType:String}`;
    }
    whereSql += ` AND IsIndirectFieldUsage = false AND IsNull = false`;

    const [requestSeries, clients, meta] = await Promise.all([
      this.getUsageRequestSeries(whereSql, timeFilters, params),
      this.getClientsWithOperations(whereSql, timeFilters, params),
      this.getMeta(whereSql, timeFilters, params),
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
    // Escape single quotes in field names and type names
    const arrayJoinFields = fields
      .map((field) => {
        const escapedName = field.name.replace(/'/g, "''");
        const escapedTypeName = field.typeName.replace(/'/g, "''");
        return `('${escapedName}', '${escapedTypeName}')`;
      })
      .join(', ');
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
        toStartOfDay(toDateTime({startDate:UInt32})) AS startDate,
        toDateTime({endDate:UInt32}) AS endDate,
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
                AND OrganizationID = {organizationId:String}
                AND FederatedGraphID = {federatedGraphId:String}
                AND IsNull = false
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

    const params = {
      startDate: start,
      endDate: end,
      organizationId,
      federatedGraphId,
    };

    const res = await this.client.queryPromise(query, params);

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
    // Escape single quotes in field names and type names
    const arrayJoinFields = fields
      .map((field) => {
        const escapedName = field.name.replace(/'/g, "''");
        const escapedTypeName = field.typeName.replace(/'/g, "''");
        return `('${escapedName}', '${escapedTypeName}')`;
      })
      .join(', ');
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
        toStartOfDay(toDateTime({startDate:UInt32})) AS startDate,
        toDateTime({endDate:UInt32}) AS endDate,
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
                AND OrganizationID = {organizationId:String}
                AND FederatedGraphID = {federatedGraphId:String}
                AND IsNull = false
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

    const params = {
      startDate: start,
      endDate: end,
      organizationId,
      federatedGraphId,
    };

    const res = await this.client.queryPromise(query, params);

    if (Array.isArray(res)) {
      return res.map((item) => ({
        name: item.name,
        typeName: item.typeName,
      }));
    }

    return [];
  }

  public async getDeprecatedFieldsUsedInOperation({
    organizationId,
    federatedGraphId,
    operationHash,
    operationName,
    range,
    dateRange,
    deprecatedFields,
  }: {
    organizationId: string;
    federatedGraphId: string;
    operationHash: string;
    operationName?: string;
    range?: number;
    dateRange?: DateRange;
    deprecatedFields: { name: string; typeNames: string[] }[];
  }): Promise<
    {
      deprecatedFieldName: string;
      deprecatedFieldTypeNames: string[];
    }[]
  > {
    if (deprecatedFields.length === 0) {
      return [];
    }

    const {
      dateRange: { end, start },
    } = parseTimeFilters(dateRange, range);

    // Build the deprecated fields array
    // Each deprecated field is represented as a tuple: (name, typeNames_array)
    // Escape single quotes
    const deprecatedFieldsArray = deprecatedFields
      .map((field) => {
        const escapedName = field.name.replace(/'/g, "''");
        const quotedTypeNames = field.typeNames.map((tn) => `'${tn.replace(/'/g, "''")}'`).join(', ');
        return `('${escapedName}', [${quotedTypeNames}])`;
      })
      .join(', ');

    const query = `
      WITH 
        toStartOfDay(toDateTime({startDate:UInt32})) AS startDate,
        toDateTime({endDate:UInt32}) AS endDate,
        deprecated_fields AS (
          SELECT
            field.1 as Name,
            field.2 as TypeNames
          FROM (
            SELECT
              arrayJoin([ ${deprecatedFieldsArray} ]) as field
          )
        )
      SELECT DISTINCT
        df.Name as deprecatedFieldName,
        df.TypeNames as deprecatedFieldTypeNames
      FROM ${this.client.database}.gql_metrics_schema_usage_lite_1d_90d
      INNER JOIN deprecated_fields AS df
        ON FieldName = df.Name
      WHERE 
        Timestamp >= startDate 
        AND Timestamp <= endDate
        AND OrganizationID = {organizationId:String}
        AND FederatedGraphID = {federatedGraphId:String}
        AND OperationHash = {operationHash:String}
        AND hasAny(TypeNames, df.TypeNames) = 1
        AND IsNull = false
        ${operationName === undefined ? '' : 'AND OperationName = {operationName:String}'}
    `;

    const params: Record<string, string | number | boolean> = {
      startDate: start,
      endDate: end,
      organizationId,
      federatedGraphId,
      operationHash,
    };

    if (operationName !== undefined) {
      params.operationName = operationName;
    }

    const res = await this.client.queryPromise(query, params);

    if (Array.isArray(res)) {
      return res.map((item) => ({
        deprecatedFieldName: item.deprecatedFieldName,
        deprecatedFieldTypeNames: Array.isArray(item.deprecatedFieldTypeNames) ? item.deprecatedFieldTypeNames : [],
      }));
    }

    return [];
  }
}
