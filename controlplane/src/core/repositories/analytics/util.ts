import { PlainMessage } from '@bufbuild/protobuf';
import {
  AnalyticsFilter,
  AnalyticsViewColumn,
  AnalyticsViewFilterOperator,
  AnalyticsViewResultFilter,
  RequestSeriesItem,
  Unit,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DateRange, TimeFilters } from '../../../types/index.js';

export type ColumnMetaData = Record<string, Partial<PlainMessage<AnalyticsViewColumn>>>;

export type BaseFilters = Record<
  string,
  PlainMessage<AnalyticsViewResultFilter> & {
    dbField: string;
    dbClause: 'where' | 'having';
  }
>;

/**
 * Builds a list of filters for an analytics view.
 * Based on an arbitrary object that represents the columns of the view, we build a list of filters.
 * @param rowTemplate
 * @param filterTemplate
 */
export function buildAnalyticsViewFilters(
  rowTemplate: Record<string, any>,
  filterTemplate: Record<string, PlainMessage<AnalyticsViewResultFilter>>,
): PlainMessage<AnalyticsViewResultFilter>[] {
  const filters: PlainMessage<AnalyticsViewResultFilter>[] = [];

  for (const filtersKey in rowTemplate) {
    if (filterTemplate[filtersKey]) {
      filters.push({
        columnName: filterTemplate[filtersKey].columnName,
        options: filterTemplate[filtersKey].options,
        title: filterTemplate[filtersKey].title,
        customOptions: filterTemplate[filtersKey].customOptions,
      });
    }
  }

  return filters;
}

/**
 * Builds a list of columns for an analytics view.
 * @param rowTemplate
 * @param columnMetadata
 */
export function buildAnalyticsViewColumns(
  rowTemplate: Record<string, any>,
  columnMetadata: ColumnMetaData,
): PlainMessage<AnalyticsViewColumn>[] {
  const columns: PlainMessage<AnalyticsViewColumn>[] = [];

  for (const column in rowTemplate) {
    const cm = columnMetadata[column];
    const resolvedColumn = Object.assign(
      {
        name: column,
        unit: Unit.Unspecified,
        type: 'string',
        title: column,
      },
      cm,
    );
    columns.push(resolvedColumn);
  }

  return columns;
}

/**
 * Fills missing fields for column metadata
 * This is useful because when we define the metadata all fields are optional
 * @param columnMetadata
 */
export function fillColumnMetaData(columnMetadata: ColumnMetaData) {
  const columnMeta: ColumnMetaData = {};

  for (const [column, meta] of Object.entries(columnMetadata)) {
    const resolvedMeta = Object.assign(
      {
        name: column,
        unit: Unit.Unspecified,
        type: 'string',
        title: column,
      },
      meta,
    );
    columnMeta[column] = resolvedMeta;
  }

  return columnMeta;
}

/**
 * Builds analytics view column from column names and metadata
 * @param columnNames
 * @param columnMetadata
 */
export function buildColumnsFromNames(
  columnNames: string[],
  columnMetadata: ColumnMetaData,
): PlainMessage<AnalyticsViewColumn>[] {
  const columns: PlainMessage<AnalyticsViewColumn>[] = [];

  for (const column of columnNames) {
    const cm = columnMetadata[column];
    const resolvedColumn = Object.assign(
      {
        name: column,
        unit: Unit.Unspecified,
        type: 'string',
        title: column,
      },
      cm,
    );
    columns.push(resolvedColumn);
  }

  return columns;
}

/**
 * Builds WHERE and HAVING SQL statements for ClickHouse.
 * This includes filters and date range.
 *
 * @param columnMetadata
 * @param coercedFilters
 * @param filterMapper
 * @param dateRange
 */
export function buildCoercedFilterSqlStatement(
  columnMetadata: ColumnMetaData,
  coercedFilters: Record<string, string | number>,
  filterMapper: Record<
    string,
    {
      fieldName: string;
      filter: AnalyticsFilter;
      dbField: string;
      dbClause: 'where' | 'having';
    }
  >,
  includeDateFilter = true,
): { whereSql: string; havingSql: string } {
  const whereFilterSqlStatement = [];
  const havingFilterSqlStatement = [];

  const groupedFilterStatements: Record<string, { statements: string[]; dbClause: 'where' | 'having' }> = {};

  for (const id in coercedFilters) {
    if (!filterMapper[id]) {
      continue;
    }

    const { fieldName, filter, dbField, dbClause } = filterMapper[id];
    const column = columnMetadata[fieldName];
    let sql = '';

    let operatorSql = '';
    switch (filter.operator) {
      case AnalyticsViewFilterOperator.EQUALS: {
        operatorSql = '=';
        break;
      }
      case AnalyticsViewFilterOperator.GREATER_THAN: {
        operatorSql = '>';
        break;
      }
      case AnalyticsViewFilterOperator.GREATER_THAN_OR_EQUAL: {
        operatorSql = '>=';
        break;
      }
      case AnalyticsViewFilterOperator.LESS_THAN: {
        operatorSql = '<';
        break;
      }
      default: {
        throw new Error(`Unknown operator: ${filter.operator}`);
      }
    }

    if (column) {
      // https://clickhouse.com/docs/en/interfaces/cli#cli-queries-with-parameters
      // https://clickhouse.com/docs/en/sql-reference/data-types

      if (column.type === 'number') {
        sql = `${dbField} ${operatorSql} {${id}:Float64}`;
      } else if (column.type === 'string') {
        sql = `${dbField} ${operatorSql} {${id}:String}`;
      }
    } else {
      sql = `${dbField} ${operatorSql} {${id}:String}`;
    }

    if (groupedFilterStatements[fieldName]) {
      groupedFilterStatements[fieldName].statements.push(sql);
    } else {
      groupedFilterStatements[fieldName] = {
        statements: [sql],
        dbClause,
      };
    }
  }

  let whereSql = '';
  let havingSql = '';

  for (const item of Object.values(groupedFilterStatements)) {
    const orStatement = '( ' + item.statements.join(' OR ') + ' )';
    if (item.dbClause === 'where') {
      whereFilterSqlStatement.push(orStatement);
    } else if (item.dbClause === 'having') {
      havingFilterSqlStatement.push(orStatement);
    }
  }

  // Here we reference to the timestamp column in the database not the alias,
  // so we can work with the real timestamp (DateTime)
  if (includeDateFilter) {
    whereFilterSqlStatement.push(`Timestamp >= toDateTime({startDate:UInt64})`);
    whereFilterSqlStatement.push(`Timestamp <= toDateTime({endDate:UInt64})`);
  }

  if (whereFilterSqlStatement.length > 0) {
    whereSql = whereFilterSqlStatement.join(' AND ');
  }

  if (havingFilterSqlStatement.length > 0) {
    havingSql = 'HAVING ' + havingFilterSqlStatement.join(' AND ');
  }

  return { whereSql, havingSql };
}

/**
 * Coerces filter values to the correct type.
 * @param columnMetadata
 * @param filters
 */
export function coerceFilterValues(
  columnMetadata: ColumnMetaData,
  filters: AnalyticsFilter[],
  baseFilters: BaseFilters,
) {
  const filterMapper: Record<
    string,
    {
      fieldName: string;
      filter: AnalyticsFilter;
      dbField: string;
      dbClause: 'where' | 'having';
    }
  > = {};
  const result: Record<string, string | number> = {};

  for (const [index, filter] of filters.entries()) {
    const column = columnMetadata[filter.field];
    const id = `${index}_${filter.field}`;
    const baseFilter = baseFilters[filter.field];

    if (!baseFilter) {
      continue;
    }

    filterMapper[id] = {
      fieldName: column?.name || filter.field,
      filter,
      dbField: baseFilter.dbField,
      dbClause: baseFilter.dbClause,
    };

    if (column) {
      if (column.type === 'number') {
        result[id] = Number.parseFloat(filter.value);
      } else if (column.type === 'string') {
        result[id] = filter.value;
      }
    } else {
      result[id] = filter.value;
    }
  }

  return { result, filterMapper };
}

export function padMissingDatesForCurrentWeek(data: PlainMessage<RequestSeriesItem>[]) {
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.getTime().toString();
  });

  for (const date of dates) {
    if (!data.some((d) => d.timestamp === date)) {
      data.push({ timestamp: date, totalRequests: 0, erroredRequests: 0 });
    }
  }

  return data.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function timestampToNanoseconds(timestamp: string): bigint {
  const [dateAndTime, fractionalSeconds] = timestamp.split('.');
  const date = new Date(dateAndTime);
  const nanoseconds = BigInt(date.getTime()) * BigInt(1e6);
  return nanoseconds + BigInt(fractionalSeconds);
}

export function isoDateRangeToTimestamps(dateRange?: DateRange, range = 24) {
  if (!dateRange) {
    const endDate = getEndDate();
    return {
      end: endDate,
      start: endDate - range * 60 * 60 * 1000,
    };
  }

  return {
    start: Math.round(new Date(dateRange.start).getTime() / 1000) * 1000,
    end: Math.round(new Date(dateRange.end).getTime() / 1000) * 1000,
  };
}

/**
 * Get unix time in seconds
 * @param timestamp Date or unix timestamp in milliseconds
 * @param offset Offset in hours
 * @returns
 */
const getUnixTimeInSeconds = (timestamp: Date | number, offset?: number) => {
  let date: number;
  if (timestamp instanceof Date) {
    date = timestamp.getTime();
  } else {
    date = timestamp;
  }

  if (offset) {
    date = date - offset * 60 * 60 * 1000;
  }

  return Math.round(date / 1000);
};

export const getEndDate = () => {
  const now = new Date();

  now.setSeconds(59);
  now.setMilliseconds(999);

  return Math.round(now.getTime() / 1000) * 1000;
};

/**
 * Returns a date range in seconds
 * @param dateRange
 * @param offset Offset in hours
 * @returns
 */
export const getDateRange = (dateRange?: { start?: number; end?: number }, offset = 0) => {
  if (dateRange?.start && dateRange?.end) {
    return [getUnixTimeInSeconds(dateRange.start, offset * 2), getUnixTimeInSeconds(dateRange.end, offset)];
  }

  const endDate = dateRange?.end || getEndDate();

  const start = getUnixTimeInSeconds(endDate, offset * 2);
  const end = getUnixTimeInSeconds(endDate, offset);

  return [start, end];
};

export const parseTimeFilters = (dateRange?: DateRange, range?: number): TimeFilters => {
  const granule = getGranularity(range);
  const parsedDateRange = isoDateRangeToTimestamps(dateRange, range);
  const [start, end] = getDateRange(parsedDateRange);

  return {
    granule,
    dateRange: {
      start,
      end,
    },
  };
};

export const getGranularity = (range = 24) => {
  if (range === 1) {
    return '5';
  } else if (range <= 4) {
    return '10';
  } else if (range <= 24) {
    return '15';
  } else if (range <= 48) {
    return '15';
  } else if (range <= 72) {
    return '60';
  } else if (range <= 168) {
    return '240';
  } else if (range > 168) {
    return '480';
  }

  return '5';
};

// parse a Date to ISO9075 format in UTC, as used by Clickhouse
export const toISO9075 = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

export const parseValue = (value?: string | number | null) => {
  if (typeof value === 'number') {
    return String(value);
  }
  return value || '0';
};