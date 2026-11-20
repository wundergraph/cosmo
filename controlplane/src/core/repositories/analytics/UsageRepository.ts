import {
  ClientWithOperations,
  FieldUsageMeta,
  RequestSeriesItem,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../clickhouse/index.js';
import { DateRange, GraphFieldUsage, TimeFilters } from '../../../types/index.js';
import { flipDateRangeValuesIfNeeded } from '../../util.js';
import { traced } from '../../tracing.js';
import { parseTimeFilters } from './util.js';

@traced
export class UsageRepository {
  constructor(private client: ClickHouseClient) {}

  private async getUsageRequestSeries(
    whereSql: string,
    timeFilters: TimeFilters,
    params: Record<string, string | number | boolean>,
  ) {
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
  ) {
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
  ): Promise<FieldUsageMeta | undefined> {
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
    isArgument: boolean;
    isInput: boolean;
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

    params.isArgument = input.isArgument;
    whereSql += ` AND IsArgument = {isArgument:Boolean}`;

    params.isInput = input.isInput;
    whereSql += ` AND IsInput = {isInput:Boolean}`;

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

  // Same filters and exact window as getFieldUsage's client totals, so counts match those in Studio.
  // https://cosmo-docs.wundergraph.com/studio/analytics/schema-field-usage
  public async getGraphFieldUsage({
    organizationId,
    federatedGraphId,
    dateRange,
  }: {
    organizationId: string;
    federatedGraphId: string;
    dateRange: DateRange<number>;
  }): Promise<GraphFieldUsage[]> {
    // The count is a string so it stays exact above 2^53 when the client parses the JSON response.
    const query = `
      WITH
        toDateTime({startDate:UInt32}) AS startDate,
        toDateTime({endDate:UInt32}) AS endDate
      SELECT
        TypeName AS typeName,
        FieldName AS fieldName,
        SubgraphIDs AS subgraphIds,
        toString(sum(TotalUsages)) AS requestCount
      FROM ${this.client.database}.gql_metrics_schema_usage_5m_90d
      ARRAY JOIN arrayDistinct(TypeNames) AS TypeName
      WHERE Timestamp >= startDate AND Timestamp <= endDate
        AND OrganizationID = {organizationId:String}
        AND FederatedGraphID = {federatedGraphId:String}
        AND IsArgument = false
        AND IsInput = false
        AND IsIndirectFieldUsage = false
        AND IsNull = false
      GROUP BY TypeName, FieldName, SubgraphIDs
    `;

    const params = {
      startDate: dateRange.start,
      endDate: dateRange.end,
      organizationId,
      federatedGraphId,
    };

    const res = await this.client.queryPromise<{
      typeName: string;
      fieldName: string;
      subgraphIds: string[];
      requestCount: string;
    }>(query, params);

    if (!Array.isArray(res)) {
      return [];
    }

    const fields = new Map<
      string,
      { typeName: string; fieldName: string; requestCount: bigint; subgraphs: Map<string, bigint> }
    >();
    for (const row of res) {
      const key = `${row.typeName}.${row.fieldName}`;
      let field = fields.get(key);
      if (!field) {
        field = {
          typeName: row.typeName,
          fieldName: row.fieldName,
          requestCount: 0n,
          subgraphs: new Map<string, bigint>(),
        };
        fields.set(key, field);
      }
      const count = BigInt(row.requestCount);
      field.requestCount += count;
      // Every subgraph that resolved the field gets the full count, as the subgraph filter of schema checks does.
      for (const subgraphId of row.subgraphIds) {
        field.subgraphs.set(subgraphId, (field.subgraphs.get(subgraphId) ?? 0n) + count);
      }
    }

    return [...fields.values()].map((field) => ({
      typeName: field.typeName,
      fieldName: field.fieldName,
      requestCount: field.requestCount,
      subgraphs: [...field.subgraphs].map(([subgraphId, requestCount]) => ({ subgraphId, requestCount })),
    }));
  }

  public async getUsedFieldPaths({
    organizationId,
    federatedGraphId,
    rangeInHours,
  }: {
    organizationId: string;
    federatedGraphId: string;
    rangeInHours: number;
  }): Promise<string[]> {
    const {
      dateRange: { end, start },
    } = parseTimeFilters(undefined, rangeInHours);

    const query = `
      WITH
        toStartOfDay(toDateTime({startDate:UInt32})) AS startDate,
        toDateTime({endDate:UInt32}) AS endDate
      SELECT DISTINCT
          concat(TypeName, '.', FieldName) AS path
      FROM gql_metrics_schema_usage_lite_1d_90d
      ARRAY JOIN TypeNames AS TypeName
      WHERE
          Timestamp >= startDate AND Timestamp <= endDate
          AND OrganizationID = {organizationId:String}
          AND FederatedGraphID = {federatedGraphId:String}
          AND IsNull = false
    `;

    const params = {
      startDate: start,
      endDate: end,
      organizationId,
      federatedGraphId,
    };

    const res = await this.client.queryPromise(query, params);

    if (Array.isArray(res)) {
      return res.map((item) => item.path);
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
