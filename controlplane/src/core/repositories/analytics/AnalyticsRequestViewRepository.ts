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
  CustomOptions,
  Unit,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { ClickHouseClient } from '../../clickhouse/index.js';
import {
  BaseFilters,
  ColumnMetaData,
  buildAnalyticsViewColumns,
  buildAnalyticsViewFilters,
  buildCoercedFilterSqlStatement,
  buildColumnsFromNames,
  coerceFilterValues,
  fillColumnMetaData,
  CoercedFilterValues,
  escapeStringsFromParams,
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
      title: 'Status',
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
      title: 'Operation',
    },
    operationType: {
      title: 'Type',
    },
    isPersisted: {
      title: 'Persisted',
      type: 'boolean',
      isHidden: true,
    },
    operationPersistedId: {
      title: 'Operation Persisted ID',
      isHidden: true,
    },
    operationContent: {
      title: 'Operation Content',
      isCta: true,
      unit: Unit.CodeBlock,
    },
    httpStatusCode: {
      title: 'HTTP Status Code',
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
    spanId: {
      title: 'Span ID',
      unit: Unit.SpanID,
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
    errors: {
      title: 'Errors',
    },
    errorRate: {
      title: 'Error Rate',
      unit: Unit.Percentage,
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
    traceId: {
      dbField: 'TraceId',
      dbClause: 'where',
      columnName: 'traceId',
      title: 'Trace ID',
      options: [],
      customOptions: CustomOptions.Text,
    },
    operationName: {
      dbField: 'OperationName',
      dbClause: 'where',
      columnName: 'operationName',
      title: 'Operation Name',
      options: [],
    },
    operationHash: {
      dbField: 'OperationHash',
      dbClause: 'where',
      columnName: 'operationHash',
      title: 'Operation Hash',
      options: [],
      customOptions: CustomOptions.Text,
    },
    statusCode: {
      dbField: 'StatusCode',
      dbClause: 'where',
      columnName: 'statusCode',
      title: 'Status',
      options: [
        {
          operator: AnalyticsViewFilterOperator.EQUALS,
          value: 'STATUS_CODE_ERROR',
          label: 'Error',
        },
      ],
    },
    operationPersistedId: {
      dbField: 'OperationPersistedID',
      dbClause: 'where',
      columnName: 'operationPersistedId',
      title: 'Operation Persisted ID',
      options: [],
      customOptions: CustomOptions.Text,
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
      options: [],
      customOptions: CustomOptions.Range,
    },
    p95: {
      dbField: 'quantilesMerge(0.95)(DurationQuantiles)[1]',
      dbClause: 'having',
      title: 'P95 Latency',
      columnName: 'p95',
      options: [],
      customOptions: CustomOptions.Range,
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
      title: 'HTTP Status Code',
      options: [],
    },
  };

  private getViewData(
    name: AnalyticsViewGroupName,
    baseWhereSql: string,
    baseHavingSql: string,
    basePaginationSql: string,
    queryParams: CoercedFilterValues,
    baseOrderSql?: string,
  ) {
    let query = ``;

    switch (name) {
      // Currently, the order of columns in the query defines the order of columns in the Studio table.
      case AnalyticsViewGroupName.None: {
        query = `
          SELECT
            TraceId as traceId,
            SpanId as spanId,
            -- DateTime64 is returned as a string
            toString(toUnixTimestamp(Timestamp)) as unixTimestamp,
            OperationName as operationName,
            OperationType as operationType,
            Duration as durationInNano,
            StatusCode as statusCode,
            StatusMessage as statusMessage,
            OperationContent as operationContent,
            HttpStatusCode as httpStatusCode,
            HttpHost as httpHost,
            HttpUserAgent as httpUserAgent,
            HttpMethod as httpMethod,
            HttpTarget as httpTarget,
            OperationPersistedID as operationPersistedId,
            OperationHash as operationHash,
            ClientName as clientName,
            ClientVersion as clientVersion,
            IF(empty(OperationPersistedID), false, true) as isPersisted
          FROM
            ${this.client.database}.traces
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
            sum(TotalRequestsError) as errors,
            round(sum(TotalRequestsError) / sum(TotalRequests) * 100, 2) as errorRate,
            toString(toUnixTimestamp(max(LastCalled))) as lastCalled
          FROM
            ${this.client.database}.traces_by_operation_quarter_hourly
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
            sum(TotalRequestsError) as errors,
            round(sum(TotalRequestsError) / sum(TotalRequests) * 100, 2) as errorRate,
            toString(toUnixTimestamp(max(LastCalled))) as lastCalled
          FROM
            ${this.client.database}.traces_by_client_quarter_hourly
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
            ${this.client.database}.traces_by_http_status_code_quarter_hourly
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
    queryParams: CoercedFilterValues,
  ): Promise<number> {
    let totalCountQuery = ``;

    switch (name) {
      case AnalyticsViewGroupName.None: {
        totalCountQuery = `
          SELECT COUNT(*) as count FROM ${this.client.database}.traces
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
              ${this.client.database}.traces_by_operation_quarter_hourly
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
              ${this.client.database}.traces_by_client_quarter_hourly
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
              ${this.client.database}.traces_by_http_status_code_quarter_hourly
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

  private async getAllOperationNames(
    whereSql: string,
    queryParams: CoercedFilterValues,
    shouldExecute: boolean,
  ): Promise<string[]> {
    if (!shouldExecute) {
      return [];
    }

    const allOperationNamesQuery = `
      SELECT DISTINCT OperationName, OrganizationID, FederatedGraphID
        FROM ${this.client.database}.traces_by_operation_quarter_hourly
      WHERE ${whereSql}
        ORDER BY Timestamp DESC
      LIMIT 100
    `;

    const operationNamesResult = await this.client?.queryPromise(allOperationNamesQuery, queryParams);

    const allOperationNames: string[] = [];
    if (Array.isArray(operationNamesResult)) {
      allOperationNames.push(...operationNamesResult.map((o) => o.OperationName));
    }

    return allOperationNames;
  }

  private async getAllClients(
    whereSql: string,
    queryParams: CoercedFilterValues,
    shouldExecute: boolean,
  ): Promise<string[]> {
    if (!shouldExecute) {
      return [];
    }

    const query = `
      SELECT DISTINCT ClientName, OrganizationID, FederatedGraphID
        FROM ${this.client.database}.traces_by_client_quarter_hourly
      WHERE ${whereSql}
        ORDER BY Timestamp DESC
      LIMIT 100
    `;

    const result = await this.client?.queryPromise(query, queryParams);

    const clientNames: string[] = [];
    if (Array.isArray(result)) {
      clientNames.push(...result.map((c) => c.ClientName));
    }

    return clientNames;
  }

  private async getAllClientVersions(
    client: string[],
    whereSql: string,
    queryParams: CoercedFilterValues,
    shouldExecute: boolean,
  ): Promise<string[]> {
    if (!shouldExecute) {
      return [];
    }

    if (client.length === 1) {
      whereSql += `AND (${client.map((c) => `ClientName = '${c}'`).join(' OR ')})`;
    }

    const query = `
      SELECT DISTINCT ClientVersion, OrganizationID, FederatedGraphID
        FROM ${this.client.database}.traces_by_client_quarter_hourly
      WHERE ${whereSql}
        ORDER BY Timestamp DESC
      LIMIT 100
    `;

    const result = await this.client?.queryPromise(query, queryParams);

    const clientVersions: string[] = [];
    if (Array.isArray(result)) {
      clientVersions.push(
        ...result.map((c) => {
          return c.ClientVersion;
        }),
      );
    }

    return clientVersions;
  }

  private async getAllHttpStatusCodes(
    whereSql: string,
    queryParams: CoercedFilterValues,
    shouldExecute: boolean,
  ): Promise<string[]> {
    if (!shouldExecute) {
      return [];
    }

    const query = `
      SELECT HttpStatusCode
        FROM ${this.client.database}.traces
      WHERE ${whereSql}
        GROUP BY HttpStatusCode
      LIMIT 100
    `;

    const result = await this.client?.queryPromise(query, queryParams);

    const httpStatusCodes: string[] = [];
    if (Array.isArray(result)) {
      httpStatusCodes.push(...result.map((s) => s.HttpStatusCode));
    }

    return httpStatusCodes;
  }

  private getBaseFiltersForGroup = (name: AnalyticsViewGroupName) => {
    const filters = { ...this.baseFilters };

    let baseFiltersForGroup: BaseFilters = {};

    switch (name) {
      case AnalyticsViewGroupName.None: {
        const {
          traceId,
          operationName,
          operationType,
          durationInNano,
          statusCode,
          httpStatusCode,
          operationPersistedId,
          operationHash,
          clientName,
          clientVersion,
        } = filters;
        baseFiltersForGroup = {
          traceId,
          operationName,
          operationType,
          durationInNano,
          statusCode,
          httpStatusCode,
          operationPersistedId,
          operationHash,
          clientName,
          clientVersion,
        };
        break;
      }
      case AnalyticsViewGroupName.OperationName: {
        const { operationName, operationType } = filters;
        baseFiltersForGroup = { operationName, operationType };
        break;
      }
      case AnalyticsViewGroupName.Client: {
        const { clientName, p95, clientVersion } = filters;
        baseFiltersForGroup = { clientName, p95, clientVersion };
        break;
      }
      case AnalyticsViewGroupName.HttpStatusCode: {
        const { p95, httpStatusCode } = filters;
        baseFiltersForGroup = { p95, httpStatusCode };
        break;
      }
    }

    return baseFiltersForGroup;
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
    const baseFilters = this.getBaseFiltersForGroup(name);

    const allowedColumnNames = new Set(Object.entries(baseFilters).map(([_, f]) => f.columnName));

    return filters.filter((f) => allowedColumnNames.has(f.field));
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
    const paginationSql = `LIMIT {limit:Int16} OFFSET {offset:Int64}`;
    const orderSql = this.getSortOrder(opts?.sort?.id, opts?.sort?.desc);

    const { result: coercedQueryParams, filterMapper } = coerceFilterValues(
      columnMetaData,
      inputFilters,
      this.baseFilters,
    );
    coercedQueryParams.limit = opts?.pagination?.limit ?? 20;
    coercedQueryParams.offset = opts?.pagination?.offset ?? 0;
    if (opts?.dateRange) {
      coercedQueryParams.startDate = Math.floor(new Date(opts.dateRange.start).getTime() / 1000);
      coercedQueryParams.endDate = Math.floor(new Date(opts.dateRange.end).getTime() / 1000);
    } else if (opts?.range) {
      const endDate = Math.floor(Date.now() / 1000);
      coercedQueryParams.startDate = Math.floor(new Date(endDate).getTime()) - opts?.range * 60 * 60;
      coercedQueryParams.endDate = endDate;
    }

    const { havingSql, ...rest } = buildCoercedFilterSqlStatement(columnMetaData, coercedQueryParams, filterMapper);
    let { whereSql } = rest;

    // Important: This is the only place where we scope the data to a particular organization and graph.
    // We can only filter for data that is part of the JWT token otherwise a user could send us whatever they want.
    const scopedSql = ` AND FederatedGraphID = '${federatedGraphId}' AND OrganizationID = '${organizationId}'`;

    whereSql += scopedSql;

    escapeStringsFromParams(coercedQueryParams);

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

    // we can't use the same whereSql as we need all values for the filters.
    // @todo include counts for each filter value.
    let { whereSql: filterWhereSql } = buildCoercedFilterSqlStatement(columnMetaData, coercedQueryParams, {});

    filterWhereSql += scopedSql;

    // We shall execute these only when we have desired results
    const [allOperationNames, allClientNames, allClientVersions, allStatusMessages] = await Promise.all([
      this.getAllOperationNames(filterWhereSql, coercedQueryParams, shouldExecute('operationName')),
      this.getAllClients(filterWhereSql, coercedQueryParams, shouldExecute('clientName')),
      this.getAllClientVersions(clientNames, filterWhereSql, coercedQueryParams, shouldExecute('clientVersion')),
      this.getAllHttpStatusCodes(filterWhereSql, coercedQueryParams, shouldExecute('httpStatusCode')),
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
      const defaultFilters = Object.values(columnFilters).map((f) => ({
        ...f,
      }));

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
