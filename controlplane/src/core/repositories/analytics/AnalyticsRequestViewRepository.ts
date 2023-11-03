import { PlainMessage } from '@bufbuild/protobuf';
import {
  AnalyticsConfig,
  AnalyticsFilter,
  AnalyticsViewFilterOperator,
  AnalyticsViewGroupName,
  AnalyticsViewResult,
  AnalyticsViewResultFilter,
  AnalyticsViewRow,
  AnalyticsViewRowValue,
  Unit,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../clickhouse/index.js';
import {
  BaseFilters,
  buildAnalyticsViewColumns,
  buildAnalyticsViewFilters,
  buildCoercedFilterSqlStatement,
  buildColumnsFromNames,
  coerceFilterValues,
  ColumnMetaData,
  fillColumnMetaData,
} from './util.js';

/**
 * Repository for clickhouse analytics data
 */
export class AnalyticsRequestViewRepository {
  constructor(private client: ClickHouseClient) {}

  public columnMetadata: ColumnMetaData = {
    durationInNano: {
      name: 'durationInNano',
      unit: Unit.Nanoseconds,
      type: 'number',
      title: 'Duration',
    },
    unixTimestamp: {
      name: 'unixTimestamp',
      unit: Unit.UnixTimestamp,
      type: 'number',
      title: 'Timestamp',
    },
    statusCode: {
      unit: Unit.StatusCode,
      title: 'Status Code',
      isHidden: true,
    },
    statusMessage: {
      title: 'Status Message',
      isHidden: true,
    },
    operationHash: {
      isHidden: true,
      title: 'Operation Hash',
    },
    operationName: {
      title: 'Name',
    },
    operationType: {
      title: 'Type',
    },
    operationContent: {
      title: 'Operation Content',
      isCta: true,
      unit: Unit.CodeBlock,
    },
    httpStatusCode: {
      title: 'Status Code',
    },
    httpHost: {
      isHidden: true,
      title: 'HTTP Host',
    },
    httpUserAgent: {
      title: 'User Agent',
      isCta: true,
    },
    httpMethod: {
      isHidden: true,
      title: 'HTTP Method',
    },
    httpTarget: {
      isHidden: true,
      title: 'HTTP Target',
    },
    traceId: {
      unit: Unit.TraceID,
      title: 'Trace ID',
    },
    totalRequests: {
      type: 'number',
      title: 'Total Requests',
    },
    p95: {
      type: 'number',
      unit: Unit.Nanoseconds,
      title: 'P95 Latency',
    },
    errorsWithRate: {
      title: 'Errors (Rate%)',
    },
    rate: {
      title: 'Rate',
    },
    lastCalled: {
      unit: Unit.UnixTimestamp,
      type: 'number',
      title: 'Last Called',
    },
    clientName: {
      title: 'Client Name',
    },
    clientVersion: {
      title: 'Client Version',
    },
  };

  public baseFilters: BaseFilters = {
    operationName: {
      dbField: 'OperationName',
      dbClause: 'where',
      columnName: 'operationName',
      title: 'Operation Name',
      options: [],
    },
    operationType: {
      dbField: 'OperationType',
      dbClause: 'where',
      title: 'Operation Type',
      columnName: 'operationType',
      options: [
        {
          operator: AnalyticsViewFilterOperator.EQUALS,
          label: 'Query',
          value: 'query',
        },
        {
          operator: AnalyticsViewFilterOperator.EQUALS,
          label: 'Mutation',
          value: 'mutation',
        },
        {
          operator: AnalyticsViewFilterOperator.EQUALS,
          label: 'Subscription',
          value: 'subscription',
        },
      ],
    },
    durationInNano: {
      dbField: 'Duration',
      dbClause: 'where',
      title: 'Duration',
      columnName: 'durationInNano',
      options: [
        {
          operator: AnalyticsViewFilterOperator.GREATER_THAN,
          label: '> 1s',
          value: '1000000000',
        },
        {
          operator: AnalyticsViewFilterOperator.LESS_THAN,
          label: '< 1s',
          value: '1000000000',
        },
      ],
    },
    p95: {
      dbField: 'quantilesMerge(0.95)(DurationQuantiles)[1]',
      dbClause: 'having',
      title: 'P95 Latency',
      columnName: 'p95',
      options: [
        {
          operator: AnalyticsViewFilterOperator.LESS_THAN,
          label: '< 150ms',
          value: '150000000',
        },
        {
          operator: AnalyticsViewFilterOperator.LESS_THAN,
          label: '< 1000ms',
          value: '1000000000',
        },
        {
          operator: AnalyticsViewFilterOperator.LESS_THAN,
          label: '< 2000ms',
          value: '2000000000',
        },
        {
          operator: AnalyticsViewFilterOperator.GREATER_THAN_OR_EQUAL,
          label: '>= 2000ms',
          value: '2000000000',
        },
      ],
    },
    clientName: {
      dbField: 'ClientName',
      dbClause: 'where',
      columnName: 'clientName',
      title: 'Client Name',
      options: [],
    },
    clientVersion: {
      dbField: 'ClientVersion',
      dbClause: 'where',
      columnName: 'clientVersion',
      title: 'Client Version',
      options: [],
    },
    httpStatusCode: {
      dbField: 'HttpStatusCode',
      dbClause: 'where',
      columnName: 'httpStatusCode',
      title: 'Http Status Code',
      options: [],
    },
  };

  private getViewData(
    name: AnalyticsViewGroupName,
    baseWhereSql: string,
    baseHavingSql: string,
    basePaginationSql: string,
    queryParams: Record<string, string | number>,
    baseOrderSql?: string,
  ) {
    let query = ``;

    switch (name) {
      case AnalyticsViewGroupName.None: {
        query = `
          SELECT
            TraceId as traceId,
            toString(toUnixTimestamp(Timestamp)) as unixTimestamp,
            -- DateTime64 is returned as a string
            OperationName as operationName,
            OperationType as operationType,
            Duration as durationInNano,
            StatusCode as statusCode,
            StatusMessage as statusMessage,
            OperationHash as operationHash,
            OperationContent as operationContent,
            HttpStatusCode as httpStatusCode,
            HttpHost as httpHost,
            HttpUserAgent as httpUserAgent,
            HttpMethod as httpMethod,
            HttpTarget as httpTarget,
            ClientName as clientName
          FROM
            ${this.client.database}.traces_mv
          WHERE
            ${baseWhereSql}
            ${baseOrderSql || 'ORDER BY Timestamp DESC'}
            ${basePaginationSql}
        `;
        break;
      }
      case AnalyticsViewGroupName.OperationName: {
        query = `
          SELECT
            OperationName as operationName,
            OperationType as operationType,
            sum(TotalRequests) as totalRequests,
            quantilesMerge(0.95)(DurationQuantiles)[1] as p95,
            CONCAT(
              toString(sum(TotalRequestsError)),
              ' (',
              toString(round(sum(TotalRequestsError) / sum(TotalRequests) * 100, 2)),
              '%)'
            ) as errorsWithRate,
            toString(toUnixTimestamp(max(LastCalled))) as lastCalled
          FROM
            ${this.client.database}.traces_by_operation_quarter_hourly_mv
          WHERE
            ${baseWhereSql}
          GROUP BY
            operationName,
            operationType
          ${baseHavingSql}
          ${baseOrderSql || 'ORDER BY totalRequests DESC'}
          ${basePaginationSql}
        `;
        break;
      }
      case AnalyticsViewGroupName.Client: {
        query = `
          SELECT
            ClientName as clientName,
            ClientVersion as clientVersion,
            sum(TotalRequests) as totalRequests,
            quantilesMerge(0.95)(DurationQuantiles)[1] as p95,
            CONCAT(
              toString(sum(TotalRequestsError)),
              ' (',
              toString(round(sum(TotalRequestsError) / sum(TotalRequests) * 100, 2)),
              '%)'
            ) as errorsWithRate,
            toString(toUnixTimestamp(max(LastCalled))) as lastCalled
          FROM
            ${this.client.database}.traces_by_client_quarter_hourly_mv
          WHERE
            ${baseWhereSql}
          GROUP BY
            clientName,
            clientVersion
          ${baseHavingSql}
          ${baseOrderSql || 'ORDER BY totalRequests DESC'}
          ${basePaginationSql}
        `;
        break;
      }
      case AnalyticsViewGroupName.HttpStatusCode: {
        query = `
          SELECT
            HttpStatusCode as httpStatusCode,
            sum(TotalRequests) as totalRequests,
            quantilesMerge(0.95)(DurationQuantiles)[1] as p95,
            toString(toUnixTimestamp(max(LastCalled))) as lastCalled
          FROM
            ${this.client.database}.traces_by_http_status_code_quarter_hourly_mv
          WHERE
            ${baseWhereSql}
          GROUP BY
            httpStatusCode
          ${baseHavingSql}
          ${baseOrderSql || 'ORDER BY totalRequests DESC'}
          ${basePaginationSql}
        `;
        break;
      }
    }

    return this.client?.queryPromise(query, queryParams);
  }

  private async getTotalCount(
    name: AnalyticsViewGroupName,
    baseWhereSql: string,
    baseHavingSql: string,
    queryParams: Record<string, string | number>,
  ): Promise<number> {
    let totalCountQuery = ``;

    switch (name) {
      case AnalyticsViewGroupName.None: {
        totalCountQuery = `
          SELECT COUNT(*) as count FROM ${this.client.database}.traces_mv
          WHERE
            ${baseWhereSql}
        `;
        break;
      }
      case AnalyticsViewGroupName.OperationName: {
        totalCountQuery = `
          SELECT COUNT(*) as count FROM (
            SELECT
              OperationName as operationName,
              OperationType as operationType,
              quantilesMerge(0.95)(DurationQuantiles)[1] as p95
            FROM
              ${this.client.database}.traces_by_operation_quarter_hourly_mv
            WHERE
              ${baseWhereSql}
            GROUP BY
              operationName,
              operationType
            ${baseHavingSql}
          )
        `;
        break;
      }
      case AnalyticsViewGroupName.Client: {
        totalCountQuery = `
          SELECT COUNT(*) as count FROM (
            SELECT
              ClientName
            FROM
              ${this.client.database}.traces_by_client_quarter_hourly_mv
            WHERE
              ${baseWhereSql}
            GROUP BY
              ClientName,
              ClientVersion
            ${baseHavingSql}
          )
        `;
        break;
      }
      case AnalyticsViewGroupName.HttpStatusCode: {
        totalCountQuery = `
          SELECT COUNT(*) as count FROM (
            SELECT
              HttpStatusCode as httpStatusCode
            FROM
              ${this.client.database}.traces_by_http_status_code_quarter_hourly_mv
            WHERE
              ${baseWhereSql}
            GROUP BY
              httpStatusCode
            ${baseHavingSql}
          )
        `;
      }
    }

    const countResult = await this.client?.queryPromise(totalCountQuery, queryParams);

    if (Array.isArray(countResult) && countResult.length > 0) {
      return countResult[0].count;
    }

    return 0;
  }

  private async getAllOperationNames(federatedGraphId: string, shouldExecute: boolean): Promise<string[]> {
    if (!shouldExecute) {
      return [];
    }

    // We need to get all operation names for the operationName filter options
    const allOperationNamesQuery = `
      SELECT DISTINCT SpanAttributes['wg.operation.name'] as operationName
      FROM ${this.client.database}.otel_traces
      WHERE
      -- Only root spans(spans which have no parent span) and has no condition on SpanKind as a span can start from either the server or the client
        empty(ParentSpanId)
        AND SpanAttributes['wg.federated_graph.id'] = '${federatedGraphId}'
      ORDER BY Timestamp DESC
      LIMIT 1000
    `;

    const operationNamesResult = await this.client?.queryPromise(allOperationNamesQuery);

    const allOperationNames: string[] = [];
    if (Array.isArray(operationNamesResult)) {
      allOperationNames.push(...operationNamesResult.map((o) => o.operationName));
    }

    return allOperationNames;
  }

  private async getAllClients(federatedGraphId: string, shouldExecute: boolean): Promise<string[]> {
    if (!shouldExecute) {
      return [];
    }

    const query = `
      SELECT DISTINCT SpanAttributes [ 'wg.client.name' ] as clientName
      FROM ${this.client.database}.otel_traces
      WHERE 
      -- Only root spans(spans which have no parent span) and has no condition on SpanKind as a span can start from either the server or the client
        empty(ParentSpanId)
        AND SpanAttributes['wg.federated_graph.id'] = '${federatedGraphId}'
      ORDER BY Timestamp DESC
      LIMIT 100
    `;

    const result = await this.client?.queryPromise(query);

    const clientNames: string[] = [];
    if (Array.isArray(result)) {
      clientNames.push(...result.map((c) => c.clientName));
    }

    return clientNames;
  }

  private async getAllClientVersions(
    federatedGraphId: string,
    client: string[],
    shouldExecute: boolean,
  ): Promise<string[]> {
    if (!shouldExecute) {
      return [];
    }

    let whereSql = '';
    if (client.length === 1) {
      whereSql = `AND (${client.map((c) => `SpanAttributes [ 'wg.client.name' ] = '${c}'`).join(' OR ')})`;
    }

    const query = `
      SELECT DISTINCT SpanAttributes [ 'wg.client.version' ] as clientVersion
      FROM ${this.client.database}.otel_traces
      WHERE 
      -- Only root spans(spans which have no parent span) and has no condition on SpanKind as a span can start from either the server or the client
        empty(ParentSpanId)
        AND SpanAttributes['wg.federated_graph.id'] = '${federatedGraphId}'
        ${whereSql}
      ORDER BY Timestamp DESC
      LIMIT 100
    `;

    const result = await this.client?.queryPromise(query);

    const clientVersions: string[] = [];
    if (Array.isArray(result)) {
      clientVersions.push(
        ...result.map((c) => {
          if (c.clientVersion === 'missing') {
            return 'unknown';
          }
          return c.clientVersion;
        }),
      );
    }

    return clientVersions;
  }

  private async getAllHttpStatusCodes(federatedGraphId: string, shouldExecute: boolean): Promise<string[]> {
    if (!shouldExecute) {
      return [];
    }

    const query = `
      SELECT DISTINCT SpanAttributes [ 'http.status_code' ] as httpStatusCode
      FROM ${this.client.database}.otel_traces
      WHERE 
      -- Only root spans(spans which have no parent span) and has no condition on SpanKind as a span can start from either the server or the client
        empty(ParentSpanId)
        AND SpanAttributes['wg.federated_graph.id'] = '${federatedGraphId}'
      LIMIT 100
    `;

    const result = await this.client?.queryPromise(query);

    const httpStatusCodes: string[] = [];
    if (Array.isArray(result)) {
      httpStatusCodes.push(...result.map((s) => s.httpStatusCode));
    }

    return httpStatusCodes;
  }

  private getBaseFiltersForGroup = (name: AnalyticsViewGroupName) => {
    const filters = { ...this.baseFilters };

    switch (name) {
      case AnalyticsViewGroupName.None: {
        const { p95, ...rest } = filters;
        return rest;
      }
      case AnalyticsViewGroupName.OperationName: {
        const { durationInNano, clientName, statusMessages, ...rest } = filters;
        return rest;
      }
      case AnalyticsViewGroupName.Client: {
        const { clientName, p95, clientVersion } = filters;
        return { clientName, p95, clientVersion };
      }
      case AnalyticsViewGroupName.HttpStatusCode: {
        const { p95, httpStatusCode } = filters;
        return { p95, httpStatusCode };
      }
    }
  };

  private getFilters(
    name: AnalyticsViewGroupName,
    operationNames: string[],
    clientNames: string[],
    clientVersions: string[],
    httpStatusCodes: string[],
  ): Record<string, PlainMessage<AnalyticsViewResultFilter>> {
    const filters = this.getBaseFiltersForGroup(name);

    if (filters.operationName) {
      filters.operationName = {
        ...filters.operationName,
        options: [
          ...filters.operationName.options,
          ...operationNames.map((op) => ({
            operator: AnalyticsViewFilterOperator.EQUALS,
            label: op || '-',
            value: op,
          })),
        ],
      };
    }

    if (filters.clientName) {
      filters.clientName = {
        ...filters.clientName,
        options: clientNames.map((c) => ({
          operator: AnalyticsViewFilterOperator.EQUALS,
          label: c || '-',
          value: c,
        })),
      };
    }

    if (filters.clientVersion) {
      filters.clientVersion = {
        ...filters.clientVersion,
        options: clientVersions.map((c) => ({
          operator: AnalyticsViewFilterOperator.EQUALS,
          label: c || '-',
          value: c,
        })),
      };
    }

    if (filters.httpStatusCode) {
      filters.httpStatusCode = {
        ...filters.httpStatusCode,
        options: httpStatusCodes.map((sc) => ({
          operator: AnalyticsViewFilterOperator.EQUALS,
          label: sc || '-',
          value: sc,
        })),
      };
    }

    return filters;
  }

  // Omit fields that are not supported in the grouped views to prevent errors
  // in the generated sql queries
  private omitGroupedFilters(name: AnalyticsViewGroupName, filters: AnalyticsFilter[]) {
    switch (name) {
      case AnalyticsViewGroupName.None: {
        return filters.filter((f) => f.field !== 'p95');
      }
      case AnalyticsViewGroupName.OperationName: {
        return filters.filter((f) => !['durationInNano', 'clientName', 'statusMessages'].includes(f.field));
      }
      case AnalyticsViewGroupName.Client: {
        return filters.filter((f) => ['clientName', 'p95', 'clientVersion'].includes(f.field));
      }
      case AnalyticsViewGroupName.HttpStatusCode: {
        return filters.filter((f) => ['p95', 'httpStatusCode'].includes(f.field));
      }
    }

    return [];
  }

  private getSortOrder = (id?: string, desc?: boolean) => {
    const allowedColumns = Object.keys(this.columnMetadata);

    if (id && allowedColumns.includes(id)) {
      return `ORDER BY ${id} ${desc ? 'DESC' : 'ASC'}`;
    }
  };

  public async getView(
    organizationId: string,
    federatedGraphId: string,
    name: AnalyticsViewGroupName,
    opts?: AnalyticsConfig,
  ): Promise<PlainMessage<AnalyticsViewResult>> {
    const inputFilters = this.omitGroupedFilters(name, opts?.filters ?? []);
    const columnMetaData = fillColumnMetaData(this.columnMetadata);
    const paginationSql = `LIMIT {limit:Int16} OFFSET {offset:Int16}`;
    const orderSql = this.getSortOrder(opts?.sort?.id, opts?.sort?.desc);

    const { result: coercedQueryParams, filterMapper } = coerceFilterValues(
      columnMetaData,
      inputFilters,
      this.baseFilters,
    );
    coercedQueryParams.limit = opts?.pagination?.limit ?? 30;
    coercedQueryParams.offset = opts?.pagination?.offset ?? 0;
    if (opts?.dateRange) {
      coercedQueryParams.startDate = Math.floor(new Date(opts.dateRange.start).getTime() / 1000);
      coercedQueryParams.endDate = Math.floor(new Date(opts.dateRange.end).getTime() / 1000);
    } else if (opts?.range) {
      const endDate = Math.floor(Date.now() / 1000);
      coercedQueryParams.startDate = Math.floor(new Date(endDate).getTime() / 1000) - opts?.range * 60 * 60 * 1000;
      coercedQueryParams.endDate = endDate;
    }

    const { havingSql, ...rest } = buildCoercedFilterSqlStatement(
      columnMetaData,
      coercedQueryParams,
      filterMapper,
      opts?.dateRange,
    );
    let { whereSql } = rest;

    // Important: This is the only place where we scope the data to a particular organization and graph.
    // We can only filter for data that is part of the JWT token otherwise a user could send us whatever they want.
    whereSql += ` AND FederatedGraphID = '${federatedGraphId}'`;
    whereSql += ` AND OrganizationID = '${organizationId}'`;

    const [result, totalCount] = await Promise.all([
      this.getViewData(name, whereSql, havingSql, paginationSql, coercedQueryParams, orderSql),
      this.getTotalCount(name, whereSql, havingSql, coercedQueryParams),
    ]);

    const clientNames: string[] = [];
    if (name === AnalyticsViewGroupName.Client) {
      const entries = Object.entries(coercedQueryParams);
      for (const [key, value] of entries) {
        if (key.endsWith('clientName')) {
          clientNames.push(String(value));
        }
      }
    }

    const baseFiltersForGroup = this.getBaseFiltersForGroup(name);
    const shouldExecute = (columnName: string) => Object.keys(baseFiltersForGroup).includes(columnName);

    // We shall execute these only when we have desired results
    const [allOperationNames, allClientNames, allClientVersions, allStatusMessages] = await Promise.all([
      this.getAllOperationNames(federatedGraphId, shouldExecute('operationName')),
      this.getAllClients(federatedGraphId, shouldExecute('clientName')),
      this.getAllClientVersions(federatedGraphId, clientNames, shouldExecute('clientVersion')),
      this.getAllHttpStatusCodes(federatedGraphId, shouldExecute('httpStatusCode')),
    ]);

    const columnFilters = this.getFilters(
      name,
      allOperationNames,
      allClientNames,
      allClientVersions,
      allStatusMessages,
    );

    let pages = 0;
    if (totalCount > 0 && opts?.pagination?.limit) {
      pages = Math.ceil(totalCount / opts.pagination.limit);
    }

    /**
     * If no results, return empty rows but with default filters and columns
     */
    if (!Array.isArray(result) || result.length === 0) {
      const defaultColumns = buildColumnsFromNames(Object.keys(columnFilters), columnMetaData);
      const defaultFilters = Object.values(columnFilters).map(
        (f) =>
          ({
            columnName: f.columnName,
            title: f.title,
            options: f.options,
          } as PlainMessage<AnalyticsViewResultFilter>),
      );

      return {
        columns: defaultColumns,
        filters: defaultFilters,
        rows: [],
        pages,
      };
    }

    /**
     * If we have results, build the columns and filters based on the first row
     * Additional information to columns and filters is added from the columnMetaData and filters
     */

    const columns = buildAnalyticsViewColumns(result[0], columnMetaData);
    const filters = buildAnalyticsViewFilters(result[0], columnFilters);

    const rows: PlainMessage<AnalyticsViewRow>[] = result.map((row) => {
      const viewRow: Record<string, PlainMessage<AnalyticsViewRowValue>> = {};

      /**
       * JSON to protobuf conversion
       */
      for (const column in row) {
        const columnValue = row[column];
        if (typeof columnValue === 'string') {
          viewRow[column] = {
            kind: { case: 'stringValue', value: columnValue },
          };
        } else if (typeof columnValue === 'number') {
          viewRow[column] = {
            kind: { case: 'numberValue', value: columnValue },
          };
        } else if (typeof columnValue === 'boolean') {
          viewRow[column] = {
            kind: { case: 'boolValue', value: columnValue },
          };
        }
      }

      return {
        value: viewRow,
      };
    });

    return {
      filters,
      columns,
      rows,
      pages,
    };
  }
}
